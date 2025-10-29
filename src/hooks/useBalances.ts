import { useState, useEffect, useCallback } from 'react';
import { useContracts } from '../contexts/ContractsContext';
import { useWallet } from '../contexts/WalletContext';
import { useOnboarding } from '../contexts/OnboardingContext';

interface Balances {
  gregoCoin: bigint | null;
  gregoCoinPremium: bigint | null;
}

interface UseBalancesReturn {
  balances: Balances;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useBalances(): UseBalancesReturn {
  const { fetchBalances } = useContracts();
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { status: onboardingStatus } = useOnboarding();

  const [balances, setBalances] = useState<Balances>({
    gregoCoin: null,
    gregoCoinPremium: null,
  });
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    // Only fetch for non-embedded wallets with an address
    if (isUsingEmbeddedWallet || !currentAddress) {
      setBalances({ gregoCoin: null, gregoCoinPremium: null });
      return;
    }

    setIsLoading(true);
    try {
      const [gcBalance, gcpBalance] = await fetchBalances();
      setBalances({
        gregoCoin: gcBalance,
        gregoCoinPremium: gcpBalance,
      });
    } catch (err) {
      // Silently fail and set to null
      setBalances({ gregoCoin: null, gregoCoinPremium: null });
    } finally {
      setIsLoading(false);
    }
  }, [fetchBalances, currentAddress, isUsingEmbeddedWallet]);

  // Auto-fetch on mount and when onboarding completes
  useEffect(() => {
    // Don't fetch during onboarding - simulateOnboardingQueries handles it
    const isOnboarding =
      onboardingStatus === 'connecting_wallet' ||
      onboardingStatus === 'registering_contracts' ||
      onboardingStatus === 'simulating_queries';

    // Fetch when: not using embedded wallet, has address, not onboarding, onboarding completed
    if (!isUsingEmbeddedWallet && currentAddress && !isOnboarding && onboardingStatus === 'completed') {
      refetch();
    }
  }, [isUsingEmbeddedWallet, currentAddress, onboardingStatus, refetch]);

  return {
    balances,
    isLoading,
    refetch,
  };
}
