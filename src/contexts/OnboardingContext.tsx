import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AztecAddress } from '@aztec/aztec.js/addresses';

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
  isSwapPending: boolean; // True if swap should execute after onboarding
  currentStep: number; // Current step number (1-based)
  totalSteps: number; // Total number of steps
}

interface OnboardingContextType extends OnboardingState {
  startOnboarding: (withSwap: boolean) => void;
  setStatus: (status: OnboardingStatus, error?: string) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  clearSwapPending: () => void;
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
  const [status, setStatusState] = useState<OnboardingStatus>('not_started');
  const [error, setError] = useState<string | null>(null);
  const [isSwapPending, setIsSwapPending] = useState(false);
  const [currentAddress] = useState<AztecAddress | null>(null);

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
      case 'error':
        return 0;
      default:
        return 0;
    }
  })();

  const startOnboarding = useCallback((withSwap: boolean) => {
    setStatusState('connecting_wallet');
    setError(null);
    setIsSwapPending(withSwap);
  }, []);

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
    setStoredOnboardingStatus(currentAddress, true);
  }, [currentAddress]);

  const resetOnboarding = useCallback(() => {
    setStatusState('not_started');
    setError(null);
    setIsSwapPending(false);
  }, []);

  const clearSwapPending = useCallback(() => {
    setIsSwapPending(false);
  }, []);

  // Check localStorage on mount and when address changes
  useEffect(() => {
    // This will be called from App when address changes
    // For now, we just expose the methods
  }, []);

  const value: OnboardingContextType = {
    status,
    error,
    isSwapPending,
    currentStep,
    totalSteps: TOTAL_STEPS,
    startOnboarding,
    setStatus,
    completeOnboarding,
    resetOnboarding,
    clearSwapPending,
  };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
