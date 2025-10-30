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
  const { status: onboardingStatus, isSwapPending, onboardingResult } = useOnboarding();

  const [balances, setBalances] = useState<Balances>({
    gregoCoin: null,
    gregoCoinPremium: null,
  });
  const [isLoading, setIsLoading] = useState(false);

  // Pre-populate balances from onboarding result when available
  useEffect(() => {
    if (onboardingResult && balances.gregoCoin === null && balances.gregoCoinPremium === null) {
      setBalances({
        gregoCoin: onboardingResult.balances.gregoCoin,
        gregoCoinPremium: onboardingResult.balances.gregoCoinPremium,
      });
    }
  }, [onboardingResult, balances.gregoCoin, balances.gregoCoinPremium]);

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

  // Auto-fetch when needed, but skip immediate fetch after onboarding without swap
  useEffect(() => {
    // Only fetch when: not using embedded wallet, has address, not onboarding
    if (!isUsingEmbeddedWallet && currentAddress && onboardingStatus !== 'completed' && isSwapPending) {
      refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUsingEmbeddedWallet, currentAddress, onboardingStatus, isSwapPending]);

  return {
    balances,
    isLoading,
    refetch,
  };
}
