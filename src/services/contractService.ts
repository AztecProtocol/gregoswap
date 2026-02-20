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
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import type { TxReceipt } from '@aztec/stdlib/tx';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';
import type { ProofOfPasswordContract } from '../../contracts/target/ProofOfPassword';
import { BigDecimal } from '../utils/bigDecimal';
import type { NetworkConfig } from '../config/networks';
import type { OnboardingResult } from '../contexts/onboarding/reducer';

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
 * Helper function to get SponsoredFPC contract data
 */
export async function getSponsoredFPCData() {
  const { SponsoredFPCContractArtifact } = await import('@aztec/noir-contracts.js/SponsoredFPC');
  const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });
  return { artifact: SponsoredFPCContractArtifact, instance: sponsoredFPCInstance };
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
  const { AMMContract, AMMContractArtifact } = await import('@aztec/noir-contracts.js/AMM');

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

  const { instance: sponsoredFPCInstance, artifact: SponsoredFPCContractArtifact } = await getSponsoredFPCData();

  // Check which contracts are already registered
  const [popMetadata, sponsoredFPCMetadata] = await wallet.batch([
    { name: 'getContractMetadata', args: [popAddress] },
    { name: 'getContractMetadata', args: [sponsoredFPCInstance.address] },
  ]);

  // Build registration batch for unregistered contracts only
  const registrationBatch: { name: 'registerContract'; args: [any, any, any] }[] = [];

  if (!popMetadata.result.instance) {
    const instance = await node.getContract(popAddress);
    registrationBatch.push({ name: 'registerContract', args: [instance, ProofOfPasswordContractArtifact, undefined] });
  }
  if (!sponsoredFPCMetadata.result.instance) {
    registrationBatch.push({
      name: 'registerContract',
      args: [sponsoredFPCInstance, SponsoredFPCContractArtifact, undefined],
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

  const [token0Reserve, token1Reserve] = await batchCall.simulate({ from: fromAddress });
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

  const [gcBalance, gcpBalance] = await batchCall.simulate({ from: address });
  return [gcBalance, gcpBalance];
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

  const [token0Reserve, token1Reserve, gcBalance, gcpBalance] = await batchCall.simulate({ from: address });
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
  return amm.methods
    .swap_tokens_for_exact_tokens(
      gregoCoin.address,
      gregoCoinPremium.address,
      BigInt(Math.round(amountOut)),
      BigInt(Math.round(amountInMax)),
      authwitNonce,
    )
    .send({ from: fromAddress });
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
 * Executes a drip (token claim) transaction
 */
export async function executeDrip(
  pop: ProofOfPasswordContract,
  password: string,
  recipient: AztecAddress,
): Promise<TxReceipt> {
  const { instance: sponsoredFPCInstance } = await getSponsoredFPCData();

  return pop.methods.check_password_and_mint(password, recipient).send({
    from: AztecAddressClass.ZERO,
    fee: {
      paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPCInstance.address),
    },
  });
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
