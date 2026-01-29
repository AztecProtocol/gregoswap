/**
 * GregoSwap Capability Manifest
 * Declares all permissions needed for the app to function with external wallets
 */

import type { AppCapabilities, ContractFunctionPattern } from '@aztec/aztec.js/wallet';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { NetworkConfig } from './networks';

/**
 * Creates a comprehensive capability manifest for GregoSwap based on network configuration.
 *
 * This manifest requests upfront authorization for all operations needed during:
 * - Onboarding (account access, contract registration, initial simulations)
 * - Swap flow (simulations, transaction execution, auth witness creation)
 * - Balance queries (private balance lookups)
 * - Drip flow (ProofOfPassword token claiming)
 *
 * With these capabilities granted:
 * - First launch: 1 capability dialog + per-transaction approvals
 * - Subsequent launches: 0 capability dialogs (already granted) + per-transaction approvals
 * - Reduction from 15+ authorization dialogs to 2 total
 *
 * @param network - Network configuration with contract addresses
 * @returns AppCapabilities manifest with specific contract addresses and functions
 */
export function createGregoSwapCapabilities(network: NetworkConfig): AppCapabilities {
  // Parse contract addresses from network config
  const gregoCoinAddress = AztecAddress.fromString(network.contracts.gregoCoin);
  const gregoCoinPremiumAddress = AztecAddress.fromString(network.contracts.gregoCoinPremium);
  const ammAddress = AztecAddress.fromString(network.contracts.amm);
  const popAddress = AztecAddress.fromString(network.contracts.pop);

  // Specific contract addresses for registration
  // Note: SponsoredFPC will be registered during drip onboarding
  const contractAddresses = [ammAddress, gregoCoinAddress, gregoCoinPremiumAddress, popAddress];

  // Simulation patterns: specific contracts and functions
  const txSimulationPatterns: ContractFunctionPattern[] = [
    // Balance queries for exchange rate (public balances)
    { contract: gregoCoinAddress, function: 'balance_of_public' },
    { contract: gregoCoinPremiumAddress, function: 'balance_of_public' },
  ];

  const utilitySimulationPatterns: ContractFunctionPattern[] = [
    // Balance queries for user (private balances)
    { contract: gregoCoinAddress, function: 'balance_of_private' },
    { contract: gregoCoinPremiumAddress, function: 'balance_of_private' },
  ];

  // Transaction patterns: specific contracts and functions
  const transactionPatterns: ContractFunctionPattern[] = [
    // Swap transaction
    { contract: ammAddress, function: 'swap_tokens_for_exact_tokens' },

    // Drip transaction (ProofOfPassword)
    { contract: popAddress, function: 'check_password_and_mint' },
  ];

  return {
    version: '1.0',
    metadata: {
      name: 'GregoSwap',
      version: '2.1.0',
      description: 'Decentralized exchange for private token swaps on Aztec',
      url: 'https://gregoswap.aztec.network',
    },
    capabilities: [
      // Account access - needed for wallet connection and account selection
      {
        type: 'accounts',
        canGet: true,
        canCreateAuthWit: false,
      },

      // Contract operations - specific contracts (AMM, tokens, ProofOfPassword, SponsoredFPC)
      {
        type: 'contracts',
        contracts: contractAddresses,
        canRegister: true,
        canGetMetadata: true,
      },

      // Simulation - specific contract functions (balance queries, swap preview)
      {
        type: 'simulation',
        utilities: {
          scope: utilitySimulationPatterns,
        },
        transactions: {
          scope: txSimulationPatterns,
        },
      },

      // Transaction execution - specific functions (swap, drip)
      {
        type: 'transaction',
        scope: transactionPatterns,
      },
    ],
  };
}
