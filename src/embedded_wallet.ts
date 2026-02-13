import { getStubAccountContractArtifact, createStubAccount } from '@aztec/accounts/stub/lazy';
import { SchnorrAccountContract } from '@aztec/accounts/schnorr/lazy';

import { getPXEConfig, type PXEConfig } from '@aztec/pxe/config';
import { createPXE, PXE } from '@aztec/pxe/client/lazy';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { BlockHeader, mergeExecutionPayloads, type ExecutionPayload, type TxSimulationResult } from '@aztec/stdlib/tx';
import type { DefaultAccountEntrypointOptions } from '@aztec/entrypoints/account';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import { SignerlessAccount, type Account, type AccountContract } from '@aztec/aztec.js/account';
import { AccountManager, type SimulateOptions } from '@aztec/aztec.js/wallet';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { SimulateInteractionOptions } from '@aztec/aztec.js/contracts';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import {
  BaseWallet,
  buildMergedSimulationResult,
  extractOptimizablePublicStaticCalls,
  simulateViaNode,
  type FeeOptions,
} from '@aztec/wallet-sdk/base-wallet';

const STORAGE_KEY_SECRET = 'gregoswap_embedded_secret';
const STORAGE_KEY_SALT = 'gregoswap_embedded_salt';

function loadOrGenerateCredentials(): { secret: Fr; salt: Fr } {
  try {
    const storedSecret = localStorage.getItem(STORAGE_KEY_SECRET);
    const storedSalt = localStorage.getItem(STORAGE_KEY_SALT);

    if (storedSecret && storedSalt) {
      return {
        secret: Fr.fromString(storedSecret),
        salt: Fr.fromString(storedSalt),
      };
    }
  } catch {
    // localStorage unavailable, fall through to generate
  }

  const secret = Fr.random();
  const salt = Fr.random();

  try {
    localStorage.setItem(STORAGE_KEY_SECRET, secret.toString());
    localStorage.setItem(STORAGE_KEY_SALT, salt.toString());
  } catch {
    // localStorage unavailable, credentials will only persist in-memory for this session
  }

  return { secret, salt };
}

/**
 * Data for generating an account.
 */
export interface AccountData {
  /**
   * Secret to derive the keys for the account.
   */
  secret: Fr;
  /**
   * Contract address salt.
   */
  salt: Fr;
  /**
   * Contract that backs the account.
   */
  contract: AccountContract;
}

export class EmbeddedWallet extends BaseWallet {
  protected accounts: Map<string, Account> = new Map();
  private accountManager: AccountManager | null = null;

  constructor(pxe: PXE, aztecNode: AztecNode) {
    super(pxe, aztecNode);
  }

  static async create(aztecNode: AztecNode) {
    const l1Contracts = await aztecNode.getL1ContractAddresses();
    const rollupAddress = l1Contracts.rollupAddress;

    const config = getPXEConfig();
    config.dataDirectory = `pxe-${rollupAddress}`;
    config.proverEnabled = true;
    const configWithContracts = {
      ...config,
      l1Contracts,
    } as PXEConfig;

    const pxe = await createPXE(aztecNode, configWithContracts);
    return new EmbeddedWallet(pxe, aztecNode);
  }

  private async createAccount(accountData?: AccountData): Promise<AccountManager> {
    // Generate random values if not provided
    const secret = accountData?.secret ?? Fr.random();
    const salt = accountData?.salt ?? Fr.random();
    // Use SchnorrAccountContract if not provided
    const contract = accountData?.contract ?? new SchnorrAccountContract(GrumpkinScalar.random());

    const accountManager = await AccountManager.create(this, secret, contract, salt);

    const instance = accountManager.getInstance();
    const artifact = await contract.getContractArtifact();

    await this.registerContract(instance, artifact, secret);

    this.accounts.set(accountManager.address.toString(), await accountManager.getAccount());

    return accountManager;
  }

  protected async getAccountFromAddress(address: AztecAddress): Promise<Account> {
    let account: Account | undefined;
    if (address.equals(AztecAddress.ZERO)) {
      account = new SignerlessAccount();
    } else if (this.accounts.has(address.toString())) {
      account = this.accounts.get(address.toString());
    } else {
      throw new Error(`Account with address ${address.toString()} not found in wallet`);
    }

    return account;
  }

  async getAccounts() {
    if (this.accounts.size === 0) {
      const { secret, salt } = loadOrGenerateCredentials();
      const accountManager = await this.createAccount({
        secret,
        salt,
        contract: new SchnorrAccountContract(deriveSigningKey(secret)),
      });
      this.accountManager = accountManager;
      const account = await accountManager.getAccount();
      this.accounts.set(accountManager.address.toString(), account);
    }
    return Array.from(this.accounts.values()).map(acc => ({ item: acc.getAddress(), alias: '' }));
  }

  getAccountManager(): AccountManager {
    if (!this.accountManager) {
      throw new Error('Account not yet initialized. Call getAccounts() first.');
    }
    return this.accountManager;
  }

  async isAccountDeployed(): Promise<boolean> {
    const accountManager = this.getAccountManager();
    const metadata = await this.getContractMetadata(accountManager.address);
    return metadata.isContractInitialized;
  }

  async deployAccount(sponsoredFPCAddress: AztecAddress) {
    const accountManager = this.getAccountManager();
    const deployMethod = await accountManager.getDeployMethod();
    return deployMethod.send({
      from: AztecAddress.ZERO,
      fee: {
        paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPCAddress),
      },
    });
  }

  private async getFakeAccountDataFor(address: AztecAddress) {
    const originalAccount = await this.getAccountFromAddress(address);
    const originalAddress = await originalAccount.getCompleteAddress();
    const contractInstance = await this.pxe.getContractInstance(originalAddress.address);
    if (!contractInstance) {
      throw new Error(`No contract instance found for address: ${originalAddress.address}`);
    }
    const stubAccount = createStubAccount(originalAddress);
    const StubAccountContractArtifact = await getStubAccountContractArtifact();
    const instance = await getContractInstanceFromInstantiationParams(StubAccountContractArtifact, {
      salt: Fr.random(),
    });
    return {
      account: stubAccount,
      instance,
      artifact: StubAccountContractArtifact,
    };
  }

  override async simulateTx(executionPayload: ExecutionPayload, opts: SimulateOptions): Promise<TxSimulationResult> {
    const feeOptions = opts.fee?.estimateGas
      ? await this.completeFeeOptionsForEstimation(opts.from, executionPayload.feePayer, opts.fee?.gasSettings)
      : await this.completeFeeOptions(opts.from, executionPayload.feePayer, opts.fee?.gasSettings);
    const { optimizableCalls, remainingCalls } = extractOptimizablePublicStaticCalls(executionPayload);
    const remainingPayload = { ...executionPayload, calls: remainingCalls };

    const chainInfo = await this.getChainInfo();
    let blockHeader: BlockHeader;
    // PXE might not be synced yet, so we pull the latest header from the node
    // To keep things consistent, we'll always try with PXE first
    try {
      blockHeader = await this.pxe.getSyncedBlockHeader();
    } catch {
      blockHeader = (await this.aztecNode.getBlockHeader())!;
    }

    const [optimizedResults, normalResult] = await Promise.all([
      optimizableCalls.length > 0
        ? simulateViaNode(
            this.aztecNode,
            optimizableCalls,
            opts.from,
            chainInfo,
            feeOptions.gasSettings,
            blockHeader,
            opts.skipFeeEnforcement ?? true,
          )
        : Promise.resolve([]),
      remainingCalls.length > 0
        ? this.simulateViaEntrypoint(
            remainingPayload,
            opts.from,
            feeOptions,
            opts.skipTxValidation,
            opts.skipFeeEnforcement ?? true,
          )
        : Promise.resolve(null),
    ]);

    return buildMergedSimulationResult(optimizedResults, normalResult);
  }

  protected override async simulateViaEntrypoint(
    executionPayload: ExecutionPayload,
    from: AztecAddress,
    feeOptions: FeeOptions,
    _skipTxValidation?: boolean,
    _skipFeeEnforcement?: boolean,
  ): Promise<TxSimulationResult> {
    const { account: fromAccount, instance, artifact } = await this.getFakeAccountDataFor(from);

    const feeExecutionPayload = await feeOptions.walletFeePaymentMethod?.getExecutionPayload();
    const executionOptions: DefaultAccountEntrypointOptions = {
      txNonce: Fr.random(),
      cancellable: this.cancellableTransactions,
      feePaymentMethodOptions: feeOptions.accountFeePaymentMethodOptions,
    };
    const finalExecutionPayload = feeExecutionPayload
      ? mergeExecutionPayloads([feeExecutionPayload, executionPayload])
      : executionPayload;
    const chainInfo = await this.getChainInfo();
    const txRequest = await fromAccount.createTxExecutionRequest(
      finalExecutionPayload,
      feeOptions.gasSettings,
      chainInfo,
      executionOptions,
    );
    return this.pxe.simulateTx(txRequest, true, true, true, {
      contracts: { [from.toString()]: { instance, artifact } },
    });
  }
}
