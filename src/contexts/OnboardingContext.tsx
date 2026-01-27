/**
 * Onboarding Context
 * Manages the onboarding flow orchestration using a reducer
 * Single unified flow: connect → register → simulate → [if no balance: drip detour] → completed
 */

import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { useWallet } from './WalletContext';
import { useContracts } from './ContractsContext';
import type { OnboardingStatus, OnboardingStep, OnboardingResult, OnboardingState, OnboardingAction, DripPhase } from '../types';
import { ONBOARDING_STEPS, ONBOARDING_STEPS_WITH_DRIP } from '../types';
import { parseDripError } from '../services/contractService';

export type { OnboardingStatus, OnboardingStep };
export { ONBOARDING_STEPS, ONBOARDING_STEPS_WITH_DRIP };

const initialState: OnboardingState = {
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
};

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'START_FLOW':
      return {
        ...initialState,
        status: 'connecting',
        isModalOpen: true,
        pendingSwap: action.initiatedSwap,
      };

    case 'ADVANCE_STATUS':
      return {
        ...state,
        status: action.status,
        error: action.status === 'error' ? state.error : null,
      };

    case 'SET_RESULT':
      return {
        ...state,
        result: action.result,
      };

    case 'SET_PASSWORD':
      return {
        ...state,
        dripPassword: action.password,
        status: 'executing_drip',
      };

    case 'MARK_REGISTERED':
      return {
        ...state,
        hasRegisteredBase: true,
      };

    case 'MARK_SIMULATED':
      return {
        ...state,
        hasSimulated: true,
      };

    case 'MARK_NEEDS_DRIP':
      return {
        ...state,
        needsDrip: true,
        pendingSwap: false, // Clear pending swap - user has no tokens to swap
      };

    case 'COMPLETE':
      return {
        ...state,
        status: 'completed',
        error: null,
      };

    case 'CLOSE_MODAL':
      return {
        ...state,
        isModalOpen: false,
        dripPassword: null,
      };

    case 'CLEAR_PENDING_SWAP':
      return {
        ...state,
        pendingSwap: false,
        isModalOpen: false,
      };

    case 'SET_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.error,
      };

    case 'RESET':
      return initialState;

    // Drip execution actions
    case 'START_DRIP':
      return {
        ...state,
        dripPhase: 'sending',
        dripError: null,
      };

    case 'DRIP_SUCCESS':
      return {
        ...state,
        dripPhase: 'success',
        dripError: null,
      };

    case 'DRIP_ERROR':
      return {
        ...state,
        dripPhase: 'error',
        dripError: action.error,
      };

    case 'DISMISS_DRIP_ERROR':
      return {
        ...state,
        dripPhase: 'idle',
        dripError: null,
      };

    default:
      return state;
  }
}

function calculateCurrentStep(status: OnboardingStatus, needsDrip: boolean): number {
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

interface OnboardingContextType {
  // State
  status: OnboardingStatus;
  error: string | null;
  currentStep: number;
  totalSteps: number;
  steps: OnboardingStep[];
  isOnboardingModalOpen: boolean;
  onboardingResult: OnboardingResult | null;
  needsDrip: boolean;

  // Derived state
  isSwapPending: boolean;
  isDripPending: boolean;
  dripPassword: string | null;

  // Tracking state
  hasRegisteredBase: boolean;
  hasSimulated: boolean;

  // Drip execution state
  dripPhase: DripPhase;
  dripError: string | null;
  isDripping: boolean;

  // Actions
  startOnboarding: (initiatedSwap?: boolean) => void;
  advanceStatus: (status: OnboardingStatus) => void;
  setOnboardingResult: (result: OnboardingResult) => void;
  markRegistered: () => void;
  markSimulated: () => void;
  closeModal: () => void;
  clearSwapPending: () => void;
  completeDripOnboarding: (password: string) => void;
  completeDripExecution: () => void;
  clearDripPassword: () => void;
  resetOnboarding: () => void;
  dismissDripError: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}

interface OnboardingProviderProps {
  children: ReactNode;
}

function setStoredOnboardingStatus(address: AztecAddress | null, completed: boolean) {
  if (!address) return;
  try {
    localStorage.setItem(`onboarding_complete_${address.toString()}`, String(completed));
  } catch {
    // Ignore localStorage errors
  }
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { simulateOnboardingQueries, isLoadingContracts, registerBaseContracts, registerDripContracts, drip } = useContracts();
  const [state, dispatch] = useReducer(onboardingReducer, initialState);

  // Ref to prevent duplicate drip execution
  const dripTriggeredRef = useRef(false);

  // Computed values
  const steps = state.needsDrip ? ONBOARDING_STEPS_WITH_DRIP : ONBOARDING_STEPS;
  const currentStep = calculateCurrentStep(state.status, state.needsDrip);
  const totalSteps = state.needsDrip ? 5 : 4;
  const isSwapPending = state.status === 'completed' && state.pendingSwap;
  const isDripPending = state.status === 'executing_drip' && state.dripPassword !== null;
  const isDripping = state.dripPhase === 'sending' || state.dripPhase === 'mining';

  // Onboarding orchestration effect
  useEffect(() => {
    async function handleOnboardingFlow() {
      if (state.status === 'idle' || state.status === 'completed' || state.status === 'error') return;

      try {
        // Step 1: After wallet connection, register base contracts (AMM, tokens)
        if (
          state.status === 'connecting' &&
          currentAddress &&
          !isUsingEmbeddedWallet &&
          !state.hasRegisteredBase
        ) {
          dispatch({ type: 'MARK_REGISTERED' });
          dispatch({ type: 'ADVANCE_STATUS', status: 'registering' });
          await registerBaseContracts();
        }

        // Step 2: After contracts are registered, simulate to check balances
        if (
          state.status === 'registering' &&
          !isLoadingContracts &&
          currentAddress &&
          !state.hasSimulated
        ) {
          dispatch({ type: 'MARK_SIMULATED' });
          dispatch({ type: 'ADVANCE_STATUS', status: 'simulating' });

          const [exchangeRate, gcBalance, gcpBalance] = await simulateOnboardingQueries();

          const result: OnboardingResult = {
            exchangeRate,
            balances: {
              gregoCoin: gcBalance,
              gregoCoinPremium: gcpBalance,
            },
          };
          dispatch({ type: 'SET_RESULT', result });

          // Check if user has no tokens - need drip detour
          const hasNoTokens = gcBalance === 0n;

          if (hasNoTokens) {
            dispatch({ type: 'MARK_NEEDS_DRIP' });
            dispatch({ type: 'ADVANCE_STATUS', status: 'registering_drip' });
            await registerDripContracts();
            dispatch({ type: 'ADVANCE_STATUS', status: 'awaiting_drip' });
          } else {
            // User has tokens, complete onboarding
            setStoredOnboardingStatus(currentAddress, true);
            dispatch({ type: 'COMPLETE' });
          }
        }
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          error: error instanceof Error ? error.message : 'Onboarding failed',
        });
      }
    }

    handleOnboardingFlow();
  }, [
    state.status,
    state.hasRegisteredBase,
    state.hasSimulated,
    currentAddress,
    isUsingEmbeddedWallet,
    isLoadingContracts,
    simulateOnboardingQueries,
    registerBaseContracts,
    registerDripContracts,
  ]);

  // Drip execution effect - triggers when password is provided during onboarding
  useEffect(() => {
    async function handleDrip() {
      if (!isDripPending || !state.dripPassword || isDripping || dripTriggeredRef.current || !currentAddress) {
        return;
      }

      dripTriggeredRef.current = true;
      dispatch({ type: 'START_DRIP' });

      try {
        await drip(state.dripPassword, currentAddress);
        dispatch({ type: 'DRIP_SUCCESS' });
        setStoredOnboardingStatus(currentAddress, true);
        dispatch({ type: 'COMPLETE' });
      } catch (error) {
        dispatch({ type: 'DRIP_ERROR', error: parseDripError(error) });
      } finally {
        dripTriggeredRef.current = false;
      }
    }

    handleDrip();
  }, [isDripPending, state.dripPassword, isDripping, currentAddress, drip]);

  // Actions
  const startOnboarding = useCallback((initiatedSwap: boolean = false) => {
    dispatch({ type: 'START_FLOW', initiatedSwap });
  }, []);

  const advanceStatus = useCallback((status: OnboardingStatus) => {
    dispatch({ type: 'ADVANCE_STATUS', status });
  }, []);

  const setOnboardingResult = useCallback((result: OnboardingResult) => {
    dispatch({ type: 'SET_RESULT', result });
  }, []);

  const markRegistered = useCallback(() => {
    dispatch({ type: 'MARK_REGISTERED' });
  }, []);

  const markSimulated = useCallback(() => {
    dispatch({ type: 'MARK_SIMULATED' });
  }, []);

  const closeModal = useCallback(() => {
    dispatch({ type: 'CLOSE_MODAL' });
  }, []);

  const clearSwapPending = useCallback(() => {
    dispatch({ type: 'CLEAR_PENDING_SWAP' });
  }, []);

  const completeDripOnboarding = useCallback((password: string) => {
    dispatch({ type: 'SET_PASSWORD', password });
  }, []);

  const completeDripExecution = useCallback(() => {
    setStoredOnboardingStatus(currentAddress, true);
    dispatch({ type: 'COMPLETE' });
  }, [currentAddress]);

  const clearDripPassword = useCallback(() => {
    dispatch({ type: 'CLOSE_MODAL' });
  }, []);

  const resetOnboarding = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const dismissDripError = useCallback(() => {
    dispatch({ type: 'DISMISS_DRIP_ERROR' });
  }, []);

  const value: OnboardingContextType = {
    status: state.status,
    error: state.error,
    currentStep,
    totalSteps,
    steps,
    isOnboardingModalOpen: state.isModalOpen,
    onboardingResult: state.result,
    needsDrip: state.needsDrip,
    isSwapPending,
    isDripPending,
    dripPassword: state.dripPassword,
    hasRegisteredBase: state.hasRegisteredBase,
    hasSimulated: state.hasSimulated,
    dripPhase: state.dripPhase,
    dripError: state.dripError,
    isDripping,
    startOnboarding,
    advanceStatus,
    setOnboardingResult,
    markRegistered,
    markSimulated,
    closeModal,
    clearSwapPending,
    completeDripOnboarding,
    completeDripExecution,
    clearDripPassword,
    resetOnboarding,
    dismissDripError,
  };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
