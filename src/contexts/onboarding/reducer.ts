/**
 * Onboarding Reducer
 * Manages the onboarding flow state machine and drip execution
 */

import { createReducerHook, type ActionsFrom } from '../utils';

// =============================================================================
// State
// =============================================================================

export type OnboardingStatus =
  | 'idle'
  | 'connecting'
  | 'registering'
  | 'simulating'
  | 'registering_drip'
  | 'awaiting_drip'
  | 'executing_drip'
  | 'completed'
  | 'error';

export type DripPhase = 'idle' | 'sending' | 'mining' | 'success' | 'error';

export interface OnboardingResult {
  exchangeRate: number;
  balances: {
    gregoCoin: bigint;
    gregoCoinPremium: bigint;
  };
}

export interface OnboardingStep {
  label: string;
  description: string;
}

export interface OnboardingState {
  status: OnboardingStatus;
  isModalOpen: boolean;
  result: OnboardingResult | null;
  pendingSwap: boolean;
  dripPassword: string | null;
  error: string | null;
  hasRegisteredBase: boolean;
  hasSimulated: boolean;
  needsDrip: boolean;
  dripPhase: DripPhase;
  dripError: string | null;
  /** Whether simulation capabilities were granted in the manifest */
  hasSimulationGrant: boolean;
}

export const initialOnboardingState: OnboardingState = {
  status: 'idle',
  isModalOpen: false,
  result: null,
  pendingSwap: false,
  dripPassword: null,
  error: null,
  hasRegisteredBase: false,
  hasSimulated: false,
  needsDrip: false,
  dripPhase: 'idle',
  dripError: null,
  hasSimulationGrant: false,
};

// =============================================================================
// Actions
// =============================================================================

export const onboardingActions = {
  startFlow: (initiatedSwap: boolean) => ({ type: 'onboarding/START_FLOW' as const, initiatedSwap }),
  advanceStatus: (status: OnboardingStatus) => ({ type: 'onboarding/ADVANCE_STATUS' as const, status }),
  setResult: (result: OnboardingResult) => ({ type: 'onboarding/SET_RESULT' as const, result }),
  setPassword: (password: string) => ({ type: 'onboarding/SET_PASSWORD' as const, password }),
  markRegistered: () => ({ type: 'onboarding/MARK_REGISTERED' as const }),
  markSimulated: () => ({ type: 'onboarding/MARK_SIMULATED' as const }),
  markNeedsDrip: () => ({ type: 'onboarding/MARK_NEEDS_DRIP' as const }),
  setSimulationGrant: (granted: boolean) => ({ type: 'onboarding/SET_SIMULATION_GRANT' as const, granted }),
  complete: () => ({ type: 'onboarding/COMPLETE' as const }),
  closeModal: () => ({ type: 'onboarding/CLOSE_MODAL' as const }),
  clearPendingSwap: () => ({ type: 'onboarding/CLEAR_PENDING_SWAP' as const }),
  setError: (error: string) => ({ type: 'onboarding/SET_ERROR' as const, error }),
  reset: () => ({ type: 'onboarding/RESET' as const }),
  // Drip actions
  startDrip: () => ({ type: 'onboarding/START_DRIP' as const }),
  dripSuccess: () => ({ type: 'onboarding/DRIP_SUCCESS' as const }),
  dripError: (error: string) => ({ type: 'onboarding/DRIP_ERROR' as const, error }),
  dismissDripError: () => ({ type: 'onboarding/DISMISS_DRIP_ERROR' as const }),
};

export type OnboardingAction = ActionsFrom<typeof onboardingActions>;

// =============================================================================
// Reducer
// =============================================================================

export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'onboarding/START_FLOW':
      return {
        ...initialOnboardingState,
        status: 'connecting',
        isModalOpen: true,
        pendingSwap: action.initiatedSwap,
      };

    case 'onboarding/ADVANCE_STATUS':
      return {
        ...state,
        status: action.status,
        error: action.status === 'error' ? state.error : null,
      };

    case 'onboarding/SET_RESULT':
      return { ...state, result: action.result };

    case 'onboarding/SET_PASSWORD':
      return { ...state, dripPassword: action.password, status: 'executing_drip' };

    case 'onboarding/MARK_REGISTERED':
      return { ...state, hasRegisteredBase: true };

    case 'onboarding/MARK_SIMULATED':
      return { ...state, hasSimulated: true };

    case 'onboarding/MARK_NEEDS_DRIP':
      return { ...state, needsDrip: true, pendingSwap: false };

    case 'onboarding/SET_SIMULATION_GRANT':
      return { ...state, hasSimulationGrant: action.granted };

    case 'onboarding/COMPLETE':
      return { ...state, status: 'completed', error: null };

    case 'onboarding/CLOSE_MODAL':
      return { ...state, isModalOpen: false, dripPassword: null };

    case 'onboarding/CLEAR_PENDING_SWAP':
      return { ...state, pendingSwap: false, isModalOpen: false };

    case 'onboarding/SET_ERROR':
      return { ...state, status: 'error', error: action.error };

    case 'onboarding/RESET':
      return initialOnboardingState;

    // Drip actions
    case 'onboarding/START_DRIP':
      return { ...state, dripPhase: 'sending', dripError: null };

    case 'onboarding/DRIP_SUCCESS':
      return { ...state, dripPhase: 'success', dripError: null };

    case 'onboarding/DRIP_ERROR':
      return { ...state, dripPhase: 'error', dripError: action.error };

    case 'onboarding/DISMISS_DRIP_ERROR':
      return { ...state, dripPhase: 'idle', dripError: null };

    default:
      return state;
  }
}

// =============================================================================
// Helpers
// =============================================================================

export function calculateCurrentStep(status: OnboardingStatus, needsDrip: boolean): number {
  switch (status) {
    case 'idle':
      return 0;
    case 'connecting':
      return 1;
    case 'registering':
      return 2;
    case 'simulating':
      return 3;
    case 'registering_drip':
      return 3;
    case 'awaiting_drip':
    case 'executing_drip':
      return 4;
    case 'completed':
      return needsDrip ? 5 : 4;
    default:
      return 0;
  }
}

export function getOnboardingSteps(hasSimulationGrant: boolean): OnboardingStep[] {
  return [
    { label: 'Connect Wallet', description: 'Select your account from the wallet extension' },
    { label: 'Register Contracts', description: 'Registering any missing contracts' },
    hasSimulationGrant
      ? { label: 'Fetch Balances', description: 'Fetching your token balances' }
      : { label: 'Approve Queries', description: 'Review and approve batched queries in your wallet' },
  ];
}

export function getOnboardingStepsWithDrip(hasSimulationGrant: boolean): OnboardingStep[] {
  return [
    { label: 'Connect Wallet', description: 'Select your account from the wallet extension' },
    { label: 'Register Contracts', description: 'Registering any missing contracts' },
    { label: 'Register Faucet', description: 'Registering the token faucet contract if needed' },
    { label: 'Claim Tokens', description: 'Claiming your free GregoCoin tokens' },
  ];
}

// Keep backwards-compatible exports for default (no grant) case
export const ONBOARDING_STEPS: OnboardingStep[] = getOnboardingSteps(false);
export const ONBOARDING_STEPS_WITH_DRIP: OnboardingStep[] = getOnboardingStepsWithDrip(false);

// =============================================================================
// Hook
// =============================================================================

export const useOnboardingReducer = createReducerHook(onboardingReducer, onboardingActions, initialOnboardingState);
