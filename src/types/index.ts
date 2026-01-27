/**
 * Centralized type definitions for gregoswap
 * This file contains shared types used across contexts, hooks, and components
 *
 * Note: Reducer-specific types (State, Action) are co-located with their reducers in src/reducers/
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { WalletProvider, PendingConnection, DiscoverySession } from '@aztec/wallet-sdk/manager';

// =============================================================================
// Network Types
// =============================================================================

export interface NetworkConfig {
  id: string;
  name: string;
  nodeUrl: string;
  chainId: string;
  rollupVersion: string;
  contracts: {
    gregoCoin: string;
    gregoCoinPremium: string;
    amm: string;
    liquidityToken: string;
    pop: string;
    salt: string;
  };
  deployer: {
    address: string;
  };
  deployedAt: string;
}

// =============================================================================
// Balances Types
// =============================================================================

/**
 * Token balances
 */
export interface Balances {
  gregoCoin: bigint | null;
  gregoCoinPremium: bigint | null;
}

// =============================================================================
// Constants
// =============================================================================

export const GREGOCOIN_USD_PRICE = 10;
export const EXCHANGE_RATE_POLL_INTERVAL_MS = 10000;

// =============================================================================
// Re-exports from Aztec SDK for convenience
// =============================================================================

export type { AztecAddress, Wallet, AztecNode, WalletProvider, PendingConnection, DiscoverySession };
