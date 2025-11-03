import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { useWallet } from './WalletContext';
import { useContracts } from './ContractsContext';

export type OnboardingFlowType = 'swap' | 'drip';

export type OnboardingStatus =
  | 'not_started' // Using embedded wallet
  | 'connecting_wallet' // Modal open, selecting account
  | 'registering_contracts' // Batch registering contracts
  | 'simulating_queries' // Batched simulation for approval (swap flow)
  | 'awaiting_drip' // Waiting for user to enter password (drip flow)
  | 'completed' // Onboarded, ready for seamless ops
  | 'error'; // Something failed

export interface OnboardingStep {
  label: string;
  description: string;
}

interface FlowConfig {
  type: OnboardingFlowType;
  steps: OnboardingStep[];
  totalSteps: number;
  requiresAction: boolean; // true for drip (needs password)
}

export const FLOW_CONFIGS: Record<OnboardingFlowType, FlowConfig> = {
  swap: {
    type: 'swap',
    steps: [
      { label: 'Connect Wallet', description: 'Select your account from the wallet extension' },
      { label: 'Register Contracts', description: 'Setting up token and AMM contracts' },
      { label: 'Approve Queries', description: 'Review and approve batched queries in your wallet' },
    ],
    totalSteps: 3,
    requiresAction: false,
  },
  drip: {
    type: 'drip',
    steps: [
      { label: 'Connect Wallet', description: 'Select your account from the wallet extension' },
      { label: 'Register Contracts', description: 'Setting up token and ProofOfPassword contracts' },
      { label: 'Approve Queries', description: 'Review and approve batched queries in your wallet' },
      { label: 'Claim Tokens', description: 'Enter password to receive free GregoCoin' },
    ],
    totalSteps: 4,
    requiresAction: true,
  },
};

interface OnboardingResult {
  exchangeRate: number;
  balances: {
    gregoCoin: bigint;
    gregoCoinPremium: bigint;
  };
}

interface OnboardingState {
  status: OnboardingStatus;
  error: string | null;
  currentStep: number; // Current step number (1-based)
  totalSteps: number; // Total number of steps
  flowType: OnboardingFlowType | null;
  currentFlow: FlowConfig | null;
}

// Minimal API exposed to consumers
interface OnboardingContextType extends OnboardingState {
  // Modal states
  isOnboardingModalOpen: boolean;
  onboardingResult: OnboardingResult | null;

  // Derived states
  isSwapPending: boolean; // Derived from flowType === 'swap'
  isDripPending: boolean; // Derived from flowType === 'drip'

  // Drip state
  dripPassword: string | null; // Password from drip onboarding

  // Actions
  startOnboardingFlow: (flowType: OnboardingFlowType) => void;
  closeModal: () => void;
  clearSwapPending: () => void;
  completeDripOnboarding: (password: string) => void;
  clearDripPassword: () => void;
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
  const { simulateOnboardingQueries, isLoadingContracts, registerContractsForFlow } = useContracts();

  // Internal state
  const [status, setStatusState] = useState<OnboardingStatus>('not_started');
  const [error, setError] = useState<string | null>(null);
  const [flowType, setFlowType] = useState<OnboardingFlowType | null>(null);
  const [onboardingResult, setOnboardingResult] = useState<OnboardingResult | null>(null);
  const [storedAddress] = useState<AztecAddress | null>(null);
  const [dripPassword, setDripPassword] = useState<string | null>(null);

  // Flow state - modal visibility
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);

  // Computed values
  const currentFlow = flowType ? FLOW_CONFIGS[flowType] : null;
  const isSwapPending = flowType === 'swap' && status !== 'completed';
  const isDripPending = flowType === 'drip' && dripPassword !== null;

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
      case 'awaiting_drip':
        return 4; // Drip has a 4th step
      case 'completed':
        return flowType === 'drip' ? 4 : 3; // Final step depends on flow
      default:
        return 0;
    }
  })();

  const totalSteps = currentFlow?.totalSteps || 3;

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
      if (!flowType) return;

      try {
        // Step 1: After wallet connection, register contracts
        if (status === 'connecting_wallet' && currentAddress && !isUsingEmbeddedWallet) {
          setStatus('registering_contracts');
          await registerContractsForFlow(flowType);
        }

        // Step 2: After contracts are registered, proceed based on flow type
        if (status === 'registering_contracts' && !isLoadingContracts && currentAddress) {
          if (flowType === 'swap') {
            // Swap flow: Simulate queries for approval
            setStatus('simulating_queries');
            const [exchangeRate, gcBalance, gcpBalance] = await simulateOnboardingQueries();
            setOnboardingResult({
              exchangeRate,
              balances: {
                gregoCoin: gcBalance,
                gregoCoinPremium: gcpBalance,
              },
            });
            completeOnboarding();
          } else if (flowType === 'drip') {
            // Drip flow: Simulate queries for approval, then wait for user action
            setStatus('simulating_queries');
            const [exchangeRate, gcBalance, gcpBalance] = await simulateOnboardingQueries();
            setOnboardingResult({
              exchangeRate,
              balances: {
                gregoCoin: gcBalance,
                gregoCoinPremium: gcpBalance,
              },
            });
            // Move to awaiting_drip instead of completing
            setStatus('awaiting_drip');
          }
        }
      } catch (error) {
        setStatus('error', error instanceof Error ? error.message : 'Onboarding failed');
      }
    }

    handleOnboardingFlow();
  }, [
    status,
    flowType,
    currentAddress,
    isUsingEmbeddedWallet,
    isLoadingContracts,
    setStatus,
    completeOnboarding,
    simulateOnboardingQueries,
    registerContractsForFlow,
  ]);

  // Auto-close modal when completed for both swap and drip flows (after showing transition)
  useEffect(() => {
    if (status === 'completed') {
      setIsOnboardingModalOpen(false);
    }
  }, [status]);

  // Public API
  const startOnboardingFlow = useCallback((newFlowType: OnboardingFlowType) => {
    setFlowType(newFlowType);
    setStatusState('connecting_wallet');
    setError(null);
    setIsOnboardingModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOnboardingModalOpen(false);
  }, []);

  const clearSwapPending = useCallback(() => {
    if (flowType === 'swap') {
      setFlowType(null);
    }
    setIsOnboardingModalOpen(false);
  }, [flowType]);

  const completeDripOnboarding = useCallback((password: string) => {
    setDripPassword(password);
    completeOnboarding();
  }, [completeOnboarding]);

  const clearDripPassword = useCallback(() => {
    setDripPassword(null);
    setFlowType(null);
  }, []);

  const resetOnboarding = useCallback(() => {
    setStatusState('not_started');
    setError(null);
    setFlowType(null);
    setOnboardingResult(null);
    setIsOnboardingModalOpen(false);
    setDripPassword(null);
  }, []);

  const value: OnboardingContextType = {
    status,
    error,
    currentStep,
    totalSteps,
    flowType,
    currentFlow,
    isOnboardingModalOpen,
    isSwapPending,
    isDripPending,
    onboardingResult,
    dripPassword,
    startOnboardingFlow,
    closeModal,
    clearSwapPending,
    completeDripOnboarding,
    clearDripPassword,
    resetOnboarding,
  };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
