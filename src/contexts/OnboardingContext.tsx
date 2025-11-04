import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
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
  | 'registering_drip' // Registering ProofOfPassword contract after password entry
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
      { label: 'Register Contracts', description: 'Setting up contracts' },
      { label: 'Approve Queries', description: 'Review and approve batched queries in your wallet' },
    ],
    totalSteps: 3,
    requiresAction: false,
  },
  drip: {
    type: 'drip',
    steps: [
      { label: 'Connect Wallet', description: 'Select your account from the wallet extension' },
      { label: 'Setup Contracts', description: 'Setting up contracts and checking balances' },
      { label: 'Claim Tokens', description: 'Enter password to receive free GregoCoin' },
    ],
    totalSteps: 3,
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
  switchedToDrip: boolean; // True if we detected no tokens and switched to drip flow
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
  const [switchedToDrip, setSwitchedToDrip] = useState(false);

  // Flow state - modal visibility
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);

  // Refs to prevent duplicate operations
  const hasRegisteredBaseContractsRef = useRef(false);
  const hasSimulatedRef = useRef(false);

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
        return 2; // Step 2 - registering base contracts
      case 'simulating_queries':
        // For swap flow: step 3 (Approve Queries)
        // For drip flow (before switching): step 2 (still setting up)
        return flowType === 'swap' ? 3 : 2;
      case 'registering_drip':
        return 2; // Drip flow step 2 - registering drip-specific contracts
      case 'awaiting_drip':
        return 3; // Drip flow step 3 - waiting for password
      case 'completed':
        return 3; // Final step is 3 for both flows
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
        // Step 1: After wallet connection, register all base contracts
        // (GregoCoin, GregoCoinPremium, AMM) regardless of initial flow type
        if (
          status === 'connecting_wallet' &&
          currentAddress &&
          !isUsingEmbeddedWallet &&
          !hasRegisteredBaseContractsRef.current
        ) {
          hasRegisteredBaseContractsRef.current = true;
          setStatus('registering_contracts');
          // Always register swap contracts first (they're needed for both flows)
          await registerContractsForFlow('swap');
        }

        // Step 2: After contracts are registered, simulate to determine the path
        if (status === 'registering_contracts' && !isLoadingContracts && currentAddress && !hasSimulatedRef.current) {
          hasSimulatedRef.current = true;
          setStatus('simulating_queries');
          const [exchangeRate, gcBalance, gcpBalance] = await simulateOnboardingQueries();
          setOnboardingResult({
            exchangeRate,
            balances: {
              gregoCoin: gcBalance,
              gregoCoinPremium: gcpBalance,
            },
          });

          // Decide flow based on balances
          const hasNoTokens = gcBalance === 0n && gcpBalance === 0n;

          if (hasNoTokens) {
            // User has no tokens - switch to drip flow and register ProofOfPassword contracts
            setSwitchedToDrip(true);
            setFlowType('drip');
            setStatus('registering_drip');
            // Register ProofOfPassword contract before showing password prompt
            await registerContractsForFlow('drip');
          } else {
            // User has tokens - complete swap onboarding
            setFlowType('swap');
            completeOnboarding();
          }
        }

        // Step 3: After drip contracts are registered, show password prompt
        if (status === 'registering_drip' && !isLoadingContracts && currentAddress) {
          // Registration is complete, now wait for user to enter password
          setStatus('awaiting_drip');
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
    // Reset refs to allow new onboarding session
    hasRegisteredBaseContractsRef.current = false;
    hasSimulatedRef.current = false;

    setFlowType(newFlowType);
    setStatusState('connecting_wallet');
    setError(null);
    setSwitchedToDrip(false);
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

  const completeDripOnboarding = useCallback(
    async (password: string) => {
      // Registration already happened in step 2, just store password and complete
      setDripPassword(password);
      completeOnboarding();
    },
    [completeOnboarding],
  );

  const clearDripPassword = useCallback(() => {
    setDripPassword(null);
    setFlowType(null);
  }, []);

  const resetOnboarding = useCallback(() => {
    // Reset refs to allow new onboarding session
    hasRegisteredBaseContractsRef.current = false;
    hasSimulatedRef.current = false;

    setStatusState('not_started');
    setError(null);
    setFlowType(null);
    setOnboardingResult(null);
    setIsOnboardingModalOpen(false);
    setDripPassword(null);
    setSwitchedToDrip(false);
  }, []);

  const value: OnboardingContextType = {
    status,
    error,
    currentStep,
    totalSteps,
    flowType,
    currentFlow,
    switchedToDrip,
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
