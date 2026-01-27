/**
 * Centralized type definitions for gregoswap
 * This file contains all shared types used across contexts, hooks, and components
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';
import type { WalletProvider, PendingConnection, DiscoverySession } from '@aztec/wallet-sdk/manager';
import type { ProofOfPasswordContract } from '../../contracts/target/ProofOfPassword';

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
// Wallet Connection Types
// =============================================================================

/**
 * Phases of the wallet connection flow
 */
export type WalletConnectionPhase =
  | 'idle' // No connection in progress
  | 'discovering' // Discovering available wallets
  | 'selecting' // User selecting a wallet
  | 'verifying' // Showing emoji verification
  | 'connecting' // Confirming connection
  | 'account_select' // Selecting account from wallet
  | 'error'; // Connection failed

/**
 * State for wallet connection reducer
 */
export interface WalletConnectionState {
  phase: WalletConnectionPhase;
  discoveredWallets: WalletProvider[];
  cancelledWalletIds: Set<string>;
  selectedWallet: WalletProvider | null;
  pendingConnection: PendingConnection | null;
  accounts: Array<{ item: AztecAddress; alias: string }>;
  error: string | null;
}

/**
 * Actions for wallet connection reducer
 */
export type WalletConnectionAction =
  | { type: 'START_DISCOVERY' }
  | { type: 'ADD_WALLET'; wallet: WalletProvider }
  | { type: 'SELECT_WALLET'; wallet: WalletProvider }
  | { type: 'SET_PENDING_CONNECTION'; connection: PendingConnection }
  | { type: 'SET_ACCOUNTS'; accounts: Array<{ item: AztecAddress; alias: string }> }
  | { type: 'SET_PHASE'; phase: WalletConnectionPhase }
  | { type: 'CANCEL_WALLET'; walletId: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' };

// =============================================================================
// Onboarding Types
// =============================================================================

/**
 * Status of the onboarding process
 * Flow: idle → connecting → registering → simulating → [if no balance: registering_drip → awaiting_drip → executing_drip →] completed
 */
export type OnboardingStatus =
  | 'idle' // No onboarding in progress
  | 'connecting' // Waiting for wallet connection
  | 'registering' // Registering base contracts (AMM, tokens)
  | 'simulating' // Running onboarding queries to check balances
  | 'registering_drip' // Registering ProofOfPassword contract (only if balance is 0)
  | 'awaiting_drip' // Waiting for user to enter password
  | 'executing_drip' // Executing drip transaction
  | 'completed' // Onboarding finished
  | 'error'; // Something failed

/**
 * Configuration for an onboarding step
 */
export interface OnboardingStep {
  label: string;
  description: string;
}

/**
 * Result of onboarding queries
 */
export interface OnboardingResult {
  exchangeRate: number;
  balances: {
    gregoCoin: bigint;
    gregoCoinPremium: bigint;
  };
}

/**
 * Phases of a drip transaction
 */
export type DripPhase = 'idle' | 'sending' | 'mining' | 'success' | 'error';

/**
 * State for onboarding reducer
 */
export interface OnboardingState {
  status: OnboardingStatus;
  isModalOpen: boolean;
  result: OnboardingResult | null;
  pendingSwap: boolean;
  dripPassword: string | null;
  error: string | null;
  // Tracking state (replaces refs)
  hasRegisteredBase: boolean;
  hasSimulated: boolean;
  // Whether we're in the drip detour (balance was 0)
  needsDrip: boolean;
  // Drip execution state
  dripPhase: DripPhase;
  dripError: string | null;
}

/**
 * Actions for onboarding reducer
 */
export type OnboardingAction =
  | { type: 'START_FLOW'; initiatedSwap: boolean }
  | { type: 'ADVANCE_STATUS'; status: OnboardingStatus }
  | { type: 'SET_RESULT'; result: OnboardingResult }
  | { type: 'SET_PASSWORD'; password: string }
  | { type: 'MARK_REGISTERED' }
  | { type: 'MARK_SIMULATED' }
  | { type: 'MARK_NEEDS_DRIP' }
  | { type: 'COMPLETE' }
  | { type: 'CLOSE_MODAL' }
  | { type: 'CLEAR_PENDING_SWAP' }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' }
  // Drip execution actions
  | { type: 'START_DRIP' }
  | { type: 'DRIP_SUCCESS' }
  | { type: 'DRIP_ERROR'; error: string }
  | { type: 'DISMISS_DRIP_ERROR' };

// =============================================================================
// Swap Types
// =============================================================================

/**
 * Phases of a swap transaction
 */
export type SwapPhase = 'idle' | 'sending' | 'mining' | 'success' | 'error';

/**
 * State for swap reducer
 */
export interface SwapState {
  fromAmount: string;
  toAmount: string;
  exchangeRate: number | null;
  isLoadingRate: boolean;
  phase: SwapPhase;
  error: string | null;
}

/**
 * Actions for swap reducer
 */
export type SwapAction =
  | { type: 'SET_FROM_AMOUNT'; amount: string }
  | { type: 'SET_TO_AMOUNT'; amount: string }
  | { type: 'SET_RATE'; rate: number }
  | { type: 'SET_LOADING_RATE'; loading: boolean }
  | { type: 'START_SWAP' }
  | { type: 'SWAP_MINING' }
  | { type: 'SWAP_SUCCESS' }
  | { type: 'SWAP_ERROR'; error: string }
  | { type: 'DISMISS_ERROR' }
  | { type: 'RESET' };

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
// Contract Types
// =============================================================================

/**
 * Contract instances used by the app
 */
export interface Contracts {
  gregoCoin: TokenContract | null;
  gregoCoinPremium: TokenContract | null;
  amm: AMMContract | null;
  pop: ProofOfPasswordContract | null;
}

/**
 * Contract registration stages
 */
export type ContractRegistrationStage = 'base' | 'drip';

/**
 * State for contracts reducer
 */
export interface ContractsState {
  contracts: Contracts;
  registeredStages: Set<ContractRegistrationStage>;
  isLoading: boolean;
}

/**
 * Actions for contracts reducer
 */
export type ContractsAction =
  | { type: 'REGISTER_START' }
  | { type: 'REGISTER_SUCCESS'; stage: ContractRegistrationStage; contracts: Partial<Contracts> }
  | { type: 'REGISTER_FAIL'; error: string }
  | { type: 'CLEAR' };

// =============================================================================
// Wallet Types
// =============================================================================

/**
 * State for wallet reducer
 */
export interface WalletState {
  wallet: Wallet | null;
  node: AztecNode | null;
  currentAddress: AztecAddress | null;
  isUsingEmbeddedWallet: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * Actions for wallet reducer
 */
export type WalletAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_EMBEDDED'; wallet: Wallet; node: AztecNode; address: AztecAddress }
  | { type: 'SET_EXTERNAL'; wallet: Wallet }
  | { type: 'SET_ADDRESS'; address: AztecAddress | null }
  | { type: 'DISCONNECT' }
  | { type: 'RESTORE_EMBEDDED'; wallet: Wallet; address: AztecAddress | null }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' };

// =============================================================================
// Onboarding Steps Configuration
// =============================================================================

/**
 * Steps shown during normal onboarding (with balance)
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  { label: 'Connect Wallet', description: 'Select your account from the wallet extension' },
  { label: 'Register Contracts', description: 'Setting up contracts' },
  { label: 'Approve Queries', description: 'Review and approve batched queries in your wallet' },
];

/**
 * Steps shown during onboarding with drip detour (no balance)
 */
export const ONBOARDING_STEPS_WITH_DRIP: OnboardingStep[] = [
  { label: 'Connect Wallet', description: 'Select your account from the wallet extension' },
  { label: 'Register Contracts', description: 'Setting up contracts' },
  { label: 'Register Faucet', description: 'Setting up the token faucet contract' },
  { label: 'Claim Tokens', description: 'Claiming your free GregoCoin tokens' },
];

// =============================================================================
// Constants
// =============================================================================

export const GREGOCOIN_USD_PRICE = 10;
export const EXCHANGE_RATE_POLL_INTERVAL_MS = 10000;

// =============================================================================
// Re-exports from Aztec SDK for convenience
// =============================================================================

export type { AztecAddress, Wallet, AztecNode, WalletProvider, PendingConnection, DiscoverySession };
