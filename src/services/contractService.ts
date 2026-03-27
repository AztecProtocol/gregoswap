/**
 * Contract Service
 * Pure functions for contract-related operations
 */

import type { Wallet } from '@aztec/aztec.js/wallet';
import type { AztecNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { AztecAddress as AztecAddressClass } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { BatchCall, getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import type { TxReceipt } from '@aztec/stdlib/tx';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '../../contracts/target/AMM';
import type { ProofOfPasswordContract } from '../../contracts/target/ProofOfPassword';
import { BigDecimal } from '../utils/bigDecimal';
import type { NetworkConfig } from '../config/networks';
import type { OnboardingResult } from '../contexts/onboarding/reducer';
import { NO_FROM } from '@aztec/aztec.js/account';
import {
  SubscriptionFPCContract,
  SubscriptionFPCContractArtifact,
} from '@gregojuice/contracts/artifacts/SubscriptionFPC';
import { SubscriptionFPC } from '@gregojuice/contracts/subscription-fpc';

/**
 * Contracts returned after swap registration
 */
export interface SwapContracts {
  gregoCoin: TokenContract;
  gregoCoinPremium: TokenContract;
  amm: AMMContract;
}

/**
 * Contracts returned after drip registration
 */
export interface DripContracts {
  pop: ProofOfPasswordContract;
}

/**
 * Registers contracts needed for the swap flow
 * Returns the contract instances after registration
 * Skips registration for contracts that are already registered
 */
export async function registerSwapContracts(
  wallet: Wallet,
  node: AztecNode,
  network: NetworkConfig,
): Promise<SwapContracts> {
  const gregoCoinAddress = AztecAddressClass.fromString(network.contracts.gregoCoin);
  const gregoCoinPremiumAddress = AztecAddressClass.fromString(network.contracts.gregoCoinPremium);
  const liquidityTokenAddress = AztecAddressClass.fromString(network.contracts.liquidityToken);
  const ammAddress = AztecAddressClass.fromString(network.contracts.amm);
  const deployerAddress = AztecAddressClass.fromString(network.deployer.address);
  const contractSalt = Fr.fromString(network.contracts.salt);

  // Import contract artifacts
  const { TokenContract, TokenContractArtifact } = await import('@aztec/noir-contracts.js/Token');
  const { AMMContract, AMMContractArtifact } = await import('../../contracts/target/AMM');

  // Check which contracts are already registered
  const [ammMetadata, gregoCoinMetadata, gregoCoinPremiumMetadata] = await wallet.batch([
    { name: 'getContractMetadata', args: [ammAddress] },
    { name: 'getContractMetadata', args: [gregoCoinAddress] },
    { name: 'getContractMetadata', args: [gregoCoinPremiumAddress] },
  ]);

  // Reconstruct contract instances for unregistered contracts
  const [ammInstance, gregoCoinInstance, gregoCoinPremiumInstance] = await Promise.all([
    !ammMetadata.result.instance
      ? getContractInstanceFromInstantiationParams(AMMContractArtifact, {
          salt: contractSalt,
          deployer: deployerAddress,
          constructorArgs: [gregoCoinAddress, gregoCoinPremiumAddress, liquidityTokenAddress],
        })
      : null,
    !gregoCoinMetadata.result.instance
      ? getContractInstanceFromInstantiationParams(TokenContractArtifact, {
          salt: contractSalt,
          deployer: deployerAddress,
          constructorArgs: [deployerAddress, 'GregoCoin', 'GRG', 18],
        })
      : null,
    !gregoCoinPremiumMetadata.result.instance
      ? getContractInstanceFromInstantiationParams(TokenContractArtifact, {
          salt: contractSalt,
          deployer: deployerAddress,
          constructorArgs: [deployerAddress, 'GregoCoinPremium', 'GRGP', 18],
        })
      : null,
  ]);

  // Build registration batch for unregistered contracts only
  const registrationBatch: { name: 'registerContract'; args: [any, any, any] }[] = [];

  if (ammInstance) {
    registrationBatch.push({ name: 'registerContract', args: [ammInstance, AMMContractArtifact, undefined] });
  }
  if (gregoCoinInstance) {
    registrationBatch.push({ name: 'registerContract', args: [gregoCoinInstance, TokenContractArtifact, undefined] });
  }
  if (gregoCoinPremiumInstance) {
    // gregoCoinPremium shares the same artifact as gregoCoin, so we can omit it
    registrationBatch.push({ name: 'registerContract', args: [gregoCoinPremiumInstance, undefined, undefined] });
  }

  // Only call batch if there are contracts to register
  if (registrationBatch.length > 0) {
    await wallet.batch(registrationBatch);
  }

  // Instantiate the contracts
  const gregoCoin = TokenContract.at(gregoCoinAddress, wallet);
  const gregoCoinPremium = TokenContract.at(gregoCoinPremiumAddress, wallet);
  const amm = AMMContract.at(ammAddress, wallet);

  return { gregoCoin, gregoCoinPremium, amm };
}

/**
 * Registers contracts needed for the drip flow
 * Returns the contract instances after registration
 * Skips registration for contracts that are already registered
 */
export async function registerDripContracts(
  wallet: Wallet,
  node: AztecNode,
  network: NetworkConfig,
): Promise<DripContracts> {
  const popAddress = AztecAddressClass.fromString(network.contracts.pop);

  const { ProofOfPasswordContract, ProofOfPasswordContractArtifact } = await import(
    '../../contracts/target/ProofOfPassword'
  );

  // Determine which FPC to use: subscription FPC (preferred) or fallback to Aztec's sponsored FPC
  const subFPC = network.subscriptionFPC;

  // Check which contracts are already registered
  const metadataChecks: { name: 'getContractMetadata'; args: [AztecAddress] }[] = [
    { name: 'getContractMetadata', args: [popAddress] },
  ];
  if (subFPC) {
    metadataChecks.push({ name: 'getContractMetadata', args: [AztecAddressClass.fromString(subFPC.address)] });
  }

  const metadataResults = await wallet.batch(metadataChecks);
  const popMetadata = metadataResults[0];

  // Build registration batch for unregistered contracts only
  const registrationBatch: { name: 'registerContract'; args: [any, any, any] }[] = [];

  if (!popMetadata.result.instance) {
    const instance = await node.getContract(popAddress);
    registrationBatch.push({ name: 'registerContract', args: [instance, ProofOfPasswordContractArtifact, undefined] });
  }

  // Register subscription FPC if configured and not yet registered
  if (!subFPC) {
    throw new Error('No subscriptionFPC configured for this network');
  }
  const subFPCMetadata = metadataResults[1];
  if (!subFPCMetadata.result.instance) {
    const fpcAddress = AztecAddressClass.fromString(subFPC.address);
    const secretKey = Fr.fromString(subFPC.secretKey);
    const instance = await node.getContract(fpcAddress);
    if (!instance) {
      throw new Error(`Subscription FPC at ${subFPC.address} not found on-chain`);
    }
    registrationBatch.push({
      name: 'registerContract',
      args: [instance, SubscriptionFPCContractArtifact, secretKey],
    });
  }

  // Only call batch if there are contracts to register
  if (registrationBatch.length > 0) {
    await wallet.batch(registrationBatch);
  }

  // Instantiate the ProofOfPassword contract
  const pop = ProofOfPasswordContract.at(popAddress, wallet);

  return { pop };
}

/**
 * Gets the current exchange rate from the AMM
 */
export async function getExchangeRate(
  wallet: Wallet,
  contracts: SwapContracts,
  fromAddress: AztecAddress,
): Promise<number> {
  const { gregoCoin, gregoCoinPremium, amm } = contracts;

  const batchCall = new BatchCall(wallet, [
    gregoCoin.methods.balance_of_public(amm.address),
    gregoCoinPremium.methods.balance_of_public(amm.address),
  ]);

  const results = await batchCall.simulate({ from: fromAddress });
  const token0Reserve = results[0].result;
  const token1Reserve = results[1].result;
  return parseFloat(new BigDecimal(token1Reserve).divide(new BigDecimal(token0Reserve)).toString());
}

/**
 * Fetches balances for a given address
 */
export async function fetchBalances(
  wallet: Wallet,
  contracts: SwapContracts,
  address: AztecAddress,
): Promise<[bigint, bigint]> {
  const { gregoCoin, gregoCoinPremium } = contracts;

  const batchCall = new BatchCall(wallet, [
    gregoCoin.methods.balance_of_private(address),
    gregoCoinPremium.methods.balance_of_private(address),
  ]);

  const results = await batchCall.simulate({ from: address });
  return [results[0].result, results[1].result];
}

/**
 * Simulates onboarding queries to get exchange rate and balances
 * This triggers wallet approval for these queries, so future reads are seamless
 */
export async function simulateOnboardingQueries(
  wallet: Wallet,
  contracts: SwapContracts,
  address: AztecAddress,
): Promise<OnboardingResult> {
  const { gregoCoin, gregoCoinPremium, amm } = contracts;

  // Create a batched simulation that includes:
  // 1. Exchange rate data (public balances of AMM)
  // 2. User's private balances
  const batchCall = new BatchCall(wallet, [
    gregoCoin.methods.balance_of_public(amm.address),
    gregoCoinPremium.methods.balance_of_public(amm.address),
    gregoCoin.methods.balance_of_private(address),
    gregoCoinPremium.methods.balance_of_private(address),
  ]);

  const results = await batchCall.simulate({ from: address });
  const [token0Reserve, token1Reserve, gcBalance, gcpBalance] = results.map(r => r.result);
  const exchangeRate = parseFloat(new BigDecimal(token1Reserve).divide(new BigDecimal(token0Reserve)).toString());

  return {
    exchangeRate,
    balances: {
      gregoCoin: gcBalance,
      gregoCoinPremium: gcpBalance,
    },
  };
}

/**
 * Executes a token swap through the AMM
 */
export async function executeSwap(
  contracts: SwapContracts,
  fromAddress: AztecAddress,
  amountOut: number,
  amountInMax: number,
): Promise<TxReceipt> {
  const { gregoCoin, gregoCoinPremium, amm } = contracts;

  const authwitNonce = Fr.random();
  const { receipt } = await amm.methods
    .swap_tokens_for_exact_tokens(
      gregoCoin.address,
      gregoCoinPremium.address,
      BigInt(Math.round(amountOut)),
      BigInt(Math.round(amountInMax)),
      authwitNonce,
    )
    .send({ from: fromAddress });
  return receipt;
}

// ── Subscription state tracking ─────────────────────────────────────

const SUBSCRIPTION_KEY = 'gregoswap_subscriptions';

function hasSubscription(userAddress: string, contractAddress: string, selector: string): boolean {
  try {
    const subs = JSON.parse(localStorage.getItem(SUBSCRIPTION_KEY) ?? '{}');
    return !!subs[`${userAddress}:${contractAddress}:${selector}`];
  } catch { return false; }
}

function markSubscribed(userAddress: string, contractAddress: string, selector: string) {
  try {
    const subs = JSON.parse(localStorage.getItem(SUBSCRIPTION_KEY) ?? '{}');
    subs[`${userAddress}:${contractAddress}:${selector}`] = true;
    localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(subs));
  } catch { /* ignore */ }
}

/**
 * Executes a sponsored swap through the SubscriptionFPC.
 * Uses subscribe on first call, sponsor on subsequent calls.
 */
export async function executeSponsoredSwap(
  wallet: Wallet,
  network: NetworkConfig,
  amm: SwapContracts['amm'],
  gregoCoin: SwapContracts['gregoCoin'],
  gregoCoinPremium: SwapContracts['gregoCoinPremium'],
  userAddress: AztecAddress,
  amountOut: number,
  amountInMax: number,
): Promise<TxReceipt> {
  const subFPC = network.subscriptionFPC;
  if (!subFPC) {
    throw new Error('No subscriptionFPC configured for this network');
  }

  const authwitNonce = Fr.random();
  const call = await amm.methods
    .swap_tokens_for_exact_tokens_from(
      userAddress,
      gregoCoin.address,
      gregoCoinPremium.address,
      BigInt(Math.round(amountOut)),
      BigInt(Math.round(amountInMax)),
      authwitNonce,
    )
    .getFunctionCall();

  const configIndex = subFPC.functions[amm.address.toString()]?.[call.selector.toString()];
  if (configIndex == null) {
    throw new Error(`No subscription config found for AMM ${amm.address.toString()} selector ${call.selector.toString()}`);
  }

  const fpcAddress = AztecAddressClass.fromString(subFPC.address);
  const rawFPC = SubscriptionFPCContract.at(fpcAddress, wallet);
  const fpc = new SubscriptionFPC(rawFPC);

  const subscribed = hasSubscription(
    userAddress.toString(),
    amm.address.toString(),
    call.selector.toString(),
  );

  if (subscribed) {
    const { receipt } = await fpc.helpers.sponsor({
      call,
      configIndex,
      userAddress,
    });
    return receipt;
  } else {
    const { receipt } = await fpc.helpers.subscribe({
      call,
      configIndex,
      userAddress,
    });
    markSubscribed(
      userAddress.toString(),
      amm.address.toString(),
      call.selector.toString(),
    );
    return receipt;
  }
}

/**
 * Parses a swap error into a user-friendly message
 */
export function parseSwapError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Swap failed. Please try again.';
  }

  const message = error.message;

  if (message.includes('Simulation failed')) {
    return message;
  }
  if (message.includes('User denied') || message.includes('rejected')) {
    return 'Transaction was rejected in wallet';
  }
  if (message.includes('Insufficient') || message.includes('insufficient')) {
    return 'Insufficient GregoCoin balance for swap';
  }

  return message;
}

/**
 * Executes a drip (token claim) transaction.
 * Uses subscription FPC when configured, falls back to Aztec's sponsored FPC.
 */
export async function executeDrip(
  wallet: Wallet,
  network: NetworkConfig,
  pop: ProofOfPasswordContract,
  password: string,
  recipient: AztecAddress,
): Promise<TxReceipt> {
  const subFPC = network.subscriptionFPC;
  if (!subFPC) {
    throw new Error('No subscriptionFPC configured for this network');
  }

  const call = await pop.methods.check_password_and_mint(password, recipient).getFunctionCall();
  const configIndex = subFPC.functions[pop.address.toString()]?.[call.selector.toString()];
  if (configIndex == null) {
    throw new Error(`No subscription config found for ${pop.address.toString()} selector ${call.selector.toString()}`);
  }

  const fpcAddress = AztecAddressClass.fromString(subFPC.address);
  const rawFPC = SubscriptionFPCContract.at(fpcAddress, wallet);
  const fpc = new SubscriptionFPC(rawFPC);

  const accounts = await wallet.getAccounts();
  const userAddress = accounts[0]?.item ?? recipient;

  const { receipt } = await fpc.helpers.subscribe({
    call,
    configIndex,
    userAddress,
  });
  return receipt;
}

/**
 * Parses a drip error into a user-friendly message
 */
export function parseDripError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Failed to claim GregoCoin. Please try again.';
  }

  const message = error.message;

  if (message.includes('Simulation failed')) {
    return message;
  }
  if (message.includes('User denied') || message.includes('rejected')) {
    return 'Transaction was rejected in wallet';
  }
  if (message.includes('password') || message.includes('Password')) {
    return 'Invalid password. Please try again.';
  }
  if (message.includes('already claimed') || message.includes('Already claimed')) {
    return 'You have already claimed your GregoCoin tokens.';
  }

  return message;
}
