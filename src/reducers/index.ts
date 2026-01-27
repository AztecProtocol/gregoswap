/**
 * Reducers Index
 * Re-exports all reducers, actions, state types, hooks, and utilities
 */

// Utilities
export { bindActions, useBoundActions, createReducerHook, type ActionsFrom } from './utils';

// Swap
export {
  swapReducer,
  swapActions,
  initialSwapState,
  useSwapReducer,
  type SwapState,
  type SwapAction,
  type SwapPhase,
} from './swap';

// Onboarding
export {
  onboardingReducer,
  onboardingActions,
  initialOnboardingState,
  useOnboardingReducer,
  calculateCurrentStep,
  ONBOARDING_STEPS,
  ONBOARDING_STEPS_WITH_DRIP,
  type OnboardingState,
  type OnboardingAction,
  type OnboardingStatus,
  type OnboardingResult,
  type OnboardingStep,
  type DripPhase,
} from './onboarding';

// Contracts
export {
  contractsReducer,
  contractsActions,
  initialContractsState,
  useContractsReducer,
  type ContractsState,
  type ContractsAction,
  type Contracts,
  type ContractRegistrationStage,
} from './contracts';

// Wallet
export {
  walletReducer,
  walletActions,
  initialWalletState,
  useWalletReducer,
  type WalletState,
  type WalletAction,
} from './wallet';
