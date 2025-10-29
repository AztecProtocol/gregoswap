import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { useWallet } from './WalletContext';
import { useContracts } from './ContractsContext';

export type OnboardingStatus =
  | 'not_started' // Using embedded wallet
  | 'connecting_wallet' // Modal open, selecting account
  | 'registering_contracts' // Batch registering contracts
  | 'simulating_queries' // Batched simulation for approval
  | 'completed' // Onboarded, ready for seamless ops
  | 'error'; // Something failed

interface OnboardingState {
  status: OnboardingStatus;
  error: string | null;
  currentStep: number; // Current step number (1-based)
  totalSteps: number; // Total number of steps
}

// Minimal API exposed to consumers
interface OnboardingContextType extends OnboardingState {
  // Modal states
  isOnboardingModalOpen: boolean;
  isSwapPending: boolean;

  // Actions
  startOnboardingFlow: (withPendingSwap?: boolean) => void;
  clearSwapPending: () => void;
  resetOnboarding: () => void;
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

const TOTAL_STEPS = 3; // Connect, Register, Simulate/Approve

// Helper to set onboarding status in localStorage
function setStoredOnboardingStatus(address: AztecAddress | null, completed: boolean) {
  if (!address) return;
  try {
    localStorage.setItem(`onboarding_complete_${address.toString()}`, String(completed));
  } catch {
    // Ignore localStorage errors
  }
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  // Pull from other contexts needed for flow orchestration
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { simulateOnboardingQueries, isLoadingContracts } = useContracts();

  // Internal state
  const [status, setStatusState] = useState<OnboardingStatus>('not_started');
  const [error, setError] = useState<string | null>(null);
  const [isSwapPending, setIsSwapPending] = useState(false);
  const [storedAddress] = useState<AztecAddress | null>(null);

  // Flow state - modal visibility
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);

  // Calculate current step based on status
  const currentStep = (() => {
    switch (status) {
      case 'not_started':
        return 0;
      case 'connecting_wallet':
        return 1;
      case 'registering_contracts':
        return 2;
      case 'simulating_queries':
        return 3;
      case 'completed':
        return 3;
      default:
        return 0;
    }
  })();

  // Internal helpers
  const setStatus = useCallback((newStatus: OnboardingStatus, errorMessage?: string) => {
    setStatusState(newStatus);
    if (errorMessage) {
      setError(errorMessage);
    } else if (newStatus !== 'error') {
      setError(null);
    }
  }, []);

  const completeOnboarding = useCallback(() => {
    setStatusState('completed');
    setError(null);
    // Store completion in localStorage
    setStoredOnboardingStatus(storedAddress, true);
  }, [storedAddress]);

  // Onboarding orchestration - advance through steps
  useEffect(() => {
    async function handleOnboardingFlow() {
      try {
        // Step 1: After wallet connection, register contracts
        if (status === 'connecting_wallet' && currentAddress && !isUsingEmbeddedWallet) {
          setStatus('registering_contracts');
        }

        // Step 2: After contracts are registered, simulate queries
        if (status === 'registering_contracts' && !isLoadingContracts && currentAddress) {
          setStatus('simulating_queries');
          await simulateOnboardingQueries();
          completeOnboarding();
        }
      } catch (error) {
        console.error('Onboarding error:', error);
        setStatus('error', error instanceof Error ? error.message : 'Onboarding failed');
      }
    }

    handleOnboardingFlow();
  }, [
    status,
    currentAddress,
    isUsingEmbeddedWallet,
    isLoadingContracts,
    setStatus,
    completeOnboarding,
    simulateOnboardingQueries,
  ]);

  // Keep modal open when completed if swap is pending (to show transition)
  // Modal will be closed by parent after swap executes
  useEffect(() => {
    if (status === 'completed' && !isSwapPending) {
      setIsOnboardingModalOpen(false);
    }
  }, [status, isSwapPending]);

  // Public API
  const startOnboardingFlow = useCallback((withPendingSwap = true) => {
    setStatusState('connecting_wallet');
    setError(null);
    setIsSwapPending(withPendingSwap);
    setIsOnboardingModalOpen(true);
  }, []);

  const clearSwapPending = useCallback(() => {
    setIsSwapPending(false);
    setIsOnboardingModalOpen(false);
  }, []);

  const resetOnboarding = useCallback(() => {
    setStatusState('not_started');
    setError(null);
    setIsSwapPending(false);
    setIsOnboardingModalOpen(false);
  }, []);

  const value: OnboardingContextType = {
    status,
    error,
    currentStep,
    totalSteps: TOTAL_STEPS,
    isOnboardingModalOpen,
    isSwapPending,
    startOnboardingFlow,
    clearSwapPending,
    resetOnboarding,
  };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
