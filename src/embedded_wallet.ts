import { getStubAccountContractArtifact, createStubAccount } from '@aztec/accounts/stub/lazy';
import { SchnorrAccountContract } from '@aztec/accounts/schnorr/lazy';

import { getPXEConfig, type PXEConfig } from '@aztec/pxe/config';
import { createPXE, PXE } from '@aztec/pxe/client/lazy';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import {
  BlockHeader,
  collectOffchainEffects,
  mergeExecutionPayloads,
  type ExecutionPayload,
  type TxSimulationResult,
} from '@aztec/stdlib/tx';
import { AccountFeePaymentMethodOptions, type DefaultAccountEntrypointOptions } from '@aztec/entrypoints/account';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import { SignerlessAccount, type Account, type AccountContract } from '@aztec/aztec.js/account';
import { AccountManager, type SimulateOptions } from '@aztec/aztec.js/wallet';
import type { AztecNode } from '@aztec/aztec.js/node';
import { type InteractionWaitOptions, NO_WAIT, type SendReturn } from '@aztec/aztec.js/contracts';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { waitForTx } from '@aztec/aztec.js/node';
import type { SendOptions } from '@aztec/aztec.js/wallet';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { CallAuthorizationRequest } from '@aztec/aztec.js/authorization';
import {
  BaseWallet,
  buildMergedSimulationResult,
  extractOptimizablePublicStaticCalls,
  simulateViaNode,
  type FeeOptions,
} from '@aztec/wallet-sdk/base-wallet';
import { txProgress, type PhaseTiming, type TxProgressEvent } from './tx-progress';
import type { FieldsOf } from '@aztec/foundation/types';
import { GasSettings } from '@aztec/stdlib/gas';
import { getSponsoredFPCData } from './services';

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

  /**
   * Completes partial user-provided fee options with wallet defaults.
   * @param from - The address where the transaction is being sent from
   * @param feePayer - The address paying for fees (if any fee payment method is embedded in the execution payload)
   * @param gasSettings - User-provided partial gas settings
   * @returns - Complete fee options that can be used to create a transaction execution request
   */
  protected override async completeFeeOptions(
    from: AztecAddress,
    feePayer?: AztecAddress,
    gasSettings?: Partial<FieldsOf<GasSettings>>,
  ): Promise<FeeOptions> {
    const maxFeesPerGas =
      gasSettings?.maxFeesPerGas ?? (await this.aztecNode.getCurrentMinFees()).mul(1 + this.minFeePadding);
    let accountFeePaymentMethodOptions;
    let walletFeePaymentMethod;
    // The transaction does not include a fee payment method, so we
    // use the sponsoredFPC
    if (!feePayer) {
      accountFeePaymentMethodOptions = AccountFeePaymentMethodOptions.EXTERNAL;
      const { instance } = await getSponsoredFPCData();
      walletFeePaymentMethod = new SponsoredFeePaymentMethod(instance.address);
    } else {
      // The transaction includes fee payment method, so we check if we are the fee payer for it
      // (this can only happen if the embedded payment method is FeeJuiceWithClaim)
      accountFeePaymentMethodOptions = from.equals(feePayer)
        ? AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM
        : AccountFeePaymentMethodOptions.EXTERNAL;
    }
    const fullGasSettings: GasSettings = GasSettings.default({ ...gasSettings, maxFeesPerGas });
    this.log.debug(`Using L2 gas settings`, fullGasSettings);
    return {
      gasSettings: fullGasSettings,
      walletFeePaymentMethod,
      accountFeePaymentMethodOptions,
    };
  }

  override async sendTx<W extends InteractionWaitOptions = undefined>(
    executionPayload: ExecutionPayload,
    opts: SendOptions<W>,
  ): Promise<SendReturn<W>> {
    const txId = crypto.randomUUID();
    const startTime = Date.now();
    const phaseTimings: TxProgressEvent['phaseTimings'] = {};
    const phases: PhaseTiming[] = [];

    // Derive a human-readable label from the first call in the payload
    const firstCall = executionPayload.calls?.[0];
    const fnName = firstCall?.name ?? 'Transaction';
    const label = fnName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const emit = (phase: TxProgressEvent['phase'], extra?: Partial<TxProgressEvent>) => {
      txProgress.emit({
        txId,
        label,
        phase,
        startTime,
        phaseTimings: { ...phaseTimings },
        phases: [...phases],
        ...extra,
      });
    };

    try {
      // --- SIMULATING (auth witness extraction) ---
      emit('simulating');
      const simulationStart = Date.now();

      const feeOptions = await this.completeFeeOptions(opts.from, executionPayload.feePayer, opts.fee?.gasSettings);

      const simulationResult = await this.simulateViaEntrypoint(executionPayload, opts.from, feeOptions, true, true);

      // Extract auth witnesses from offchain effects
      const offchainEffects = collectOffchainEffects(simulationResult.privateExecutionResult);
      const authWitnesses = await Promise.all(
        offchainEffects.map(async effect => {
          try {
            const authRequest = await CallAuthorizationRequest.fromFields(effect.data);
            return this.createAuthWit(opts.from, {
              consumer: effect.contractAddress,
              innerHash: authRequest.innerHash,
            });
          } catch {
            return undefined; // Not a CallAuthorizationRequest, skip
          }
        }),
      );
      for (const wit of authWitnesses) {
        if (wit) executionPayload.authWitnesses.push(wit);
      }

      const simulationDuration = Date.now() - simulationStart;
      phaseTimings.simulation = simulationDuration;
      phases.push({ name: 'Simulation', duration: simulationDuration, color: '#ce93d8' });

      // --- PROVING ---
      emit('proving');
      const provingStart = Date.now();

      const txRequest = await this.createTxExecutionRequestFromPayloadAndFee(executionPayload, opts.from, feeOptions);
      const provenTx = await this.pxe.proveTx(txRequest);

      const provingDuration = Date.now() - provingStart;
      phaseTimings.proving = provingDuration;

      // Extract detailed stats from proving result if available
      const stats = provenTx.stats;
      if (stats?.timings) {
        const t = stats.timings;
        if (t.sync && t.sync > 0) phases.push({ name: 'Sync', duration: t.sync, color: '#90caf9' });
        if (t.perFunction?.length > 0) {
          const witgenTotal = t.perFunction.reduce((sum: number, fn: { time: number }) => sum + fn.time, 0);
          phases.push({
            name: 'Witgen',
            duration: witgenTotal,
            color: '#ffb74d',
            breakdown: t.perFunction.map((fn: { functionName: string; time: number }) => ({
              label: fn.functionName.split(':').pop() || fn.functionName,
              duration: fn.time,
            })),
          });
        }
        if (t.proving && t.proving > 0) phases.push({ name: 'Proving', duration: t.proving, color: '#f48fb1' });
        if (t.unaccounted > 0) phases.push({ name: 'Other', duration: t.unaccounted, color: '#bdbdbd' });
      } else {
        phases.push({ name: 'Proving', duration: provingDuration, color: '#f48fb1' });
      }

      // --- SENDING ---
      emit('sending');
      const sendingStart = Date.now();

      const tx = await provenTx.toTx();
      const txHash = tx.getTxHash();
      if (await this.aztecNode.getTxEffect(txHash)) {
        throw new Error(`A settled tx with equal hash ${txHash.toString()} exists.`);
      }
      await this.aztecNode.sendTx(tx);

      const sendingDuration = Date.now() - sendingStart;
      phaseTimings.sending = sendingDuration;
      phases.push({ name: 'Sending', duration: sendingDuration, color: '#2196f3' });

      // NO_WAIT: return txHash immediately
      if (opts.wait === NO_WAIT) {
        emit('complete');
        return txHash as SendReturn<W>;
      }

      // --- MINING ---
      emit('mining');
      const miningStart = Date.now();

      const waitOpts = typeof opts.wait === 'object' ? opts.wait : undefined;
      const receipt = await waitForTx(this.aztecNode, txHash, waitOpts);

      const miningDuration = Date.now() - miningStart;
      phaseTimings.mining = miningDuration;
      phases.push({ name: 'Mining', duration: miningDuration, color: '#4caf50' });

      emit('complete');
      return receipt as SendReturn<W>;
    } catch (err) {
      emit('error', { error: err instanceof Error ? err.message : 'Transaction failed' });
      throw err;
    }
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
