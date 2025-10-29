import { useContext, useEffect, useState } from 'react';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';
import { useContracts } from '../contexts/ContractsContext';
import { useWallet } from '../contexts/WalletContext';

interface UseOnboardingFlowProps {
  onboardingStatus: string;
  isSwapPending: boolean;
  setOnboardingStatus: (status: any, error?: string) => void;
  completeOnboarding: () => void;
}

interface UseOnboardingFlowReturn {
  isOnboardingModalOpen: boolean;
  showTransition: boolean;
  setIsOnboardingModalOpen: (open: boolean) => void;
  setShowTransition: (show: boolean) => void;
}

export function useOnboardingFlow({
  onboardingStatus,
  isSwapPending,
  setOnboardingStatus,
  completeOnboarding,
}: UseOnboardingFlowProps): UseOnboardingFlowReturn {
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { simulateOnboardingQueries, isLoadingContracts } = useContracts();

  // Onboarding orchestration - advance through steps
  useEffect(() => {
    async function handleOnboardingFlow() {
      try {
        // Step 1: After wallet connection, register contracts
        if (onboardingStatus === 'connecting_wallet' && currentAddress && !isUsingEmbeddedWallet) {
          setOnboardingStatus('registering_contracts');
        }

        // Step 2: After contracts are registered, simulate queries
        if (onboardingStatus === 'registering_contracts' && !isLoadingContracts && currentAddress) {
          setOnboardingStatus('simulating_queries');
          await simulateOnboardingQueries();
          completeOnboarding();
        }
      } catch (error) {
        console.error('Onboarding error:', error);
        setOnboardingStatus('error', error instanceof Error ? error.message : 'Onboarding failed');
      }
    }

    handleOnboardingFlow();
  }, [
    onboardingStatus,
    currentAddress,
    isUsingEmbeddedWallet,
    isLoadingContracts,
    setOnboardingStatus,
    completeOnboarding,
    simulateOnboardingQueries,
  ]);

  // After onboarding completes, close modal, show transition and execute swap if pending
  useEffect(() => {
    if (onboardingStatus === 'completed') {
      setIsOnboardingModalOpen(false);
      if (isSwapPending) {
        setShowTransition(true);
      }
    }
  }, [onboardingStatus, isSwapPending]);

  return {
    isOnboardingModalOpen,
    showTransition,
    setIsOnboardingModalOpen,
    setShowTransition,
  };
}
