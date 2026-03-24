import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { collectOffchainEffects, type ExecutionPayload } from '@aztec/stdlib/tx';
import { AccountFeePaymentMethodOptions } from '@aztec/entrypoints/account';
import type { AztecNode } from '@aztec/aztec.js/node';
import {
  type InteractionWaitOptions,
  NO_WAIT,
  type SendReturn,
  extractOffchainOutput,
  getGasLimits,
} from '@aztec/aztec.js/contracts';
import { waitForTx } from '@aztec/aztec.js/node';
import { NO_FROM, type NoFrom } from '@aztec/aztec.js/account';
import type { SendOptions } from '@aztec/aztec.js/wallet';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { CallAuthorizationRequest } from '@aztec/aztec.js/authorization';
import { type FeeOptions } from '@aztec/wallet-sdk/base-wallet';
import { txProgress, type PhaseTiming, type TxProgressEvent } from './tx-progress';
import type { FieldsOf } from '@aztec/foundation/types';
import { GasSettings } from '@aztec/stdlib/gas';
import { getSponsoredFPCData } from './services';
import { EmbeddedWallet as EmbeddedWalletBase, type EmbeddedWalletOptions } from '@aztec/wallets/embedded';
import { AccountManager, ContractInitializationStatus } from '@aztec/aztec.js/wallet';
import { Fr } from '@aztec/foundation/curves/bn254';

export class EmbeddedWallet extends EmbeddedWalletBase {
  static override create<T extends EmbeddedWalletBase = EmbeddedWallet>(
    nodeOrUrl: string | AztecNode,
    options?: EmbeddedWalletOptions,
  ): Promise<T> {
    return super.create<T>(nodeOrUrl, options);
  }

  /**
   * Returns the AccountManager for the first stored account, creating a new Schnorr
   * account (with random credentials) if none exist yet. The account is persisted in
   * the embedded wallet's internal DB, so the same address is restored on subsequent loads.
   */
  async getOrCreateAccount(): Promise<AccountManager> {
    const existing = await this.getAccounts();
    if (existing.length > 0) {
      const { secretKey, salt, signingKey, type } = await this.walletDB.retrieveAccount(existing[0].item);
      return this.createAccountInternal(type, secretKey, salt, signingKey);
    }
    return this.createSchnorrAccount(Fr.random(), Fr.random(), undefined, 'main');
  }

  async isAccountDeployed(): Promise<boolean> {
    const [account] = await this.getAccounts();
    if (!account) {
      return false;
    }
    const metadata = await this.getContractMetadata(account.item);
    return metadata.initializationStatus === ContractInitializationStatus.INITIALIZED;
  }

  async deployAccount() {
    const accountManager = await this.getOrCreateAccount();

    const { instance: sponsoredFPCInstance, artifact: SponsoredFPCContractArtifact } = await getSponsoredFPCData();
    const sponsoredFPCMetadata = await this.getContractMetadata(sponsoredFPCInstance.address);
    if (!sponsoredFPCMetadata.instance) {
      await this.registerContract(sponsoredFPCInstance, SponsoredFPCContractArtifact);
    }

    const deployMethod = await accountManager.getDeployMethod();

    return await deployMethod.send({
      from: AztecAddress.ZERO,
      fee: {
        paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPCInstance.address),
      },
    });
  }

  /**
   * Completes partial user-provided fee options with wallet defaults.
   * @param from - The address where the transaction is being sent from
   * @param feePayer - The address paying for fees (if any fee payment method is embedded in the execution payload)
   * @param gasSettings - User-provided partial gas settings
   * @returns - Complete fee options that can be used to create a transaction execution request
   */
  protected override async completeFeeOptions(
    from: AztecAddress | NoFrom,
    feePayer?: AztecAddress,
    gasSettings?: Partial<FieldsOf<GasSettings>>,
  ): Promise<FeeOptions> {
    const maxFeesPerGas =
      gasSettings?.maxFeesPerGas ?? (await this.aztecNode.getCurrentMinFees()).mul(1 + this.minFeePadding);
    let accountFeePaymentMethodOptions;
    let walletFeePaymentMethod;
    // The transaction does not include a fee payment method, so we
    // use the sponsoredFPC
    if (from !== NO_FROM) {
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
    const phases: PhaseTiming[] = [];

    // Derive a human-readable label from the first meaningful call in the payload
    // Skip fee payment methods (e.g. sponsor_unconditionally) to find the actual user call
    const meaningfulCall =
      executionPayload.calls?.find(c => c.name !== 'sponsor_unconditionally') ?? executionPayload.calls?.[0];
    const fnName = meaningfulCall?.name ?? 'Transaction';
    const label =
      fnName === 'constructor' ? 'Deploy' : fnName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const emit = (phase: TxProgressEvent['phase'], extra?: Partial<TxProgressEvent>) => {
      txProgress.emit({
        txId,
        label,
        phase,
        startTime,
        phaseStartTime: Date.now(),
        phases: [...phases],
        ...extra,
      });
    };

    try {
      const feeOptions = await this.completeFeeOptionsForEstimation(
        opts.from,
        executionPayload.feePayer,
        opts.fee?.gasSettings,
      );

      emit('simulating');
      const simulationStart = Date.now();
      const simulationResult = await this.simulateViaEntrypoint(executionPayload, {
        from: opts.from,
        feeOptions,
        scopes: this.scopesFrom(opts.from),
        skipFeeEnforcement: true,
        skipTxValidation: true,
      });
      const offchainEffects = collectOffchainEffects(simulationResult.privateExecutionResult);
      const authWitnesses = await Promise.all(
        offchainEffects.map(async effect => {
          try {
            const authRequest = await CallAuthorizationRequest.fromFields(effect.data);
            return this.createAuthWit(authRequest.onBehalfOf, {
              consumer: effect.contractAddress,
              innerHash: authRequest.innerHash,
            });
          } catch {
            return undefined;
          }
        }),
      );
      for (const wit of authWitnesses) {
        if (wit) executionPayload.authWitnesses.push(wit);
      }
      const simulationDuration = Date.now() - simulationStart;
      const simStats = simulationResult.stats;
      const breakdown: Array<{ label: string; duration: number }> = [];
      const details: string[] = [];
      if (simStats?.timings) {
        const t = simStats.timings;
        if (t.sync > 0) breakdown.push({ label: 'Sync', duration: t.sync });
        if (t.perFunction.length > 0) {
          const witgenTotal = t.perFunction.reduce((sum, fn) => sum + fn.time, 0);
          breakdown.push({
            label: 'Private execution',
            duration: witgenTotal,
          });
          for (const fn of t.perFunction) {
            breakdown.push({
              label: `  ${fn.functionName.split(':').pop() || fn.functionName}`,
              duration: fn.time,
            });
          }
        }
        if (t.publicSimulation)
          breakdown.push({
            label: 'Public simulation',
            duration: t.publicSimulation,
          });
        if (t.unaccounted > 0) breakdown.push({ label: 'Other', duration: t.unaccounted });
      }
      if (simStats?.nodeRPCCalls?.roundTrips) {
        const rt = simStats.nodeRPCCalls.roundTrips;
        const fmt = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
        details.push(`${rt.roundTrips} RPC round-trips (${fmt(rt.totalBlockingTime)} blocking)`);
      }
      phases.push({
        name: 'Simulation',
        duration: simulationDuration,
        color: '#ce93d8',
        ...(breakdown.length > 0 && { breakdown }),
        ...(details.length > 0 && { details }),
      });

      emit('proving');
      const provingStart = Date.now();
      const estimated = getGasLimits(simulationResult, this.estimatedGasPadding);
      this.log.verbose(
        `Estimated gas limits for tx: DA=${estimated.gasLimits.daGas} L2=${estimated.gasLimits.l2Gas} teardownDA=${estimated.teardownGasLimits.daGas} teardownL2=${estimated.teardownGasLimits.l2Gas}`,
      );
      const gasSettings = GasSettings.from({
        ...opts.fee?.gasSettings,
        maxFeesPerGas: feeOptions.gasSettings.maxFeesPerGas,
        maxPriorityFeesPerGas: feeOptions.gasSettings.maxPriorityFeesPerGas,
        gasLimits: opts.fee?.gasSettings?.gasLimits ?? estimated.gasLimits,
        teardownGasLimits: opts.fee?.gasSettings?.teardownGasLimits ?? estimated.teardownGasLimits,
      });
      const txRequest = await this.createTxExecutionRequestFromPayloadAndFee(executionPayload, opts.from, {
        ...feeOptions,
        gasSettings,
      });
      const provenTx = await this.pxe.proveTx(txRequest, this.scopesFrom(opts.from));
      const provingDuration = Date.now() - provingStart;
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
        if (t.proving && t.proving > 0)
          phases.push({
            name: 'Proving',
            duration: t.proving,
            color: '#f48fb1',
          });
        if (t.unaccounted > 0)
          phases.push({
            name: 'Other',
            duration: t.unaccounted,
            color: '#bdbdbd',
          });
      } else {
        phases.push({
          name: 'Proving',
          duration: provingDuration,
          color: '#f48fb1',
        });
      }

      const offchainOutput = extractOffchainOutput(
        provenTx.getOffchainEffects(),
        provenTx.publicInputs.constants.anchorBlockHeader.globalVariables.timestamp,
      );

      const tx = await provenTx.toTx();
      const txHash = tx.getTxHash();
      emit('sending');
      const sendingStart = Date.now();
      if (await this.aztecNode.getTxEffect(txHash)) {
        throw new Error(`A settled tx with equal hash ${txHash.toString()} exists.`);
      }
      await this.aztecNode.sendTx(tx);
      phases.push({
        name: 'Sending',
        duration: Date.now() - sendingStart,
        color: '#2196f3',
      });

      if (opts.wait === NO_WAIT) {
        emit('complete');
        return { txHash, ...offchainOutput } as unknown as SendReturn<W>;
      }

      emit('mining');
      const miningStart = Date.now();
      const waitOpts = typeof opts.wait === 'object' ? opts.wait : undefined;
      const receipt = await waitForTx(this.aztecNode, txHash, waitOpts);
      phases.push({
        name: 'Mining',
        duration: Date.now() - miningStart,
        color: '#4caf50',
      });

      emit('complete');
      return { receipt, ...offchainOutput } as unknown as SendReturn<W>;
    } catch (err) {
      emit('error', {
        error: err instanceof Error ? err.message : 'Transaction failed',
      });
      throw err;
    }
  }
}
