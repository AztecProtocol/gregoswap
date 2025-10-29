import { useState, useEffect, useRef } from 'react';
import { useContracts } from '../contexts/ContractsContext';
import { useWallet } from '../contexts/WalletContext';
import { useOnboarding } from '../contexts/OnboardingContext';

interface UseSwapProps {
  fromAmount: string;
  toAmount: string;
}

interface UseSwapReturn {
  // USD values
  fromAmountUSD: number;
  toAmountUSD: number;

  // Exchange rate
  exchangeRate: number | undefined;
  isLoadingRate: boolean;

  // Validation
  canSwap: boolean;

  // Swap state
  isSwapping: boolean;
  swapPhase: 'sending' | 'mining';
  swapError: string | null;

  // Handlers
  executeSwap: () => Promise<void>;
  dismissError: () => void;
}

const GREGOCOIN_USD_PRICE = 10;

export function useSwap({ fromAmount, toAmount }: UseSwapProps): UseSwapReturn {
  // Pull from contexts
  const { getExchangeRate, swap, fetchBalances, isLoadingContracts } = useContracts();
  const { isUsingEmbeddedWallet, currentAddress } = useWallet();
  const { status: onboardingStatus } = useOnboarding();

  // State for exchange rate
  const [exchangeRate, setExchangeRate] = useState<number | undefined>(undefined);
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const isFetchingRateRef = useRef(false);

  // State for swap
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapPhase, setSwapPhase] = useState<'sending' | 'mining'>('sending');
  const [swapError, setSwapError] = useState<string | null>(null);

  // Calculate USD values
  const fromAmountUSD = fromAmount ? parseFloat(fromAmount) * GREGOCOIN_USD_PRICE : 0;
  const toAmountUSD = toAmount && exchangeRate ? parseFloat(toAmount) * GREGOCOIN_USD_PRICE * exchangeRate : 0;

  // Fetch exchange rate with auto-refresh every 10 seconds
  useEffect(() => {
    async function fetchExchangeRate() {
      const shouldPause =
        isLoadingContracts ||
        isSwapping ||
        onboardingStatus === 'connecting_wallet' ||
        onboardingStatus === 'simulating_queries' ||
        onboardingStatus === 'registering_contracts' ||
        (!isUsingEmbeddedWallet && onboardingStatus !== 'completed');

      if (shouldPause) {
        setIsLoadingRate(false);
        isFetchingRateRef.current = false;
        return;
      }

      if (isFetchingRateRef.current) {
        return;
      }

      try {
        isFetchingRateRef.current = true;
        setIsLoadingRate(true);
        const rate = await getExchangeRate();
        setExchangeRate(rate);
      } catch (err) {
        console.error('Failed to fetch exchange rate:', err);
      } finally {
        setIsLoadingRate(false);
        isFetchingRateRef.current = false;
      }
    }

    fetchExchangeRate();
    const intervalId = setInterval(fetchExchangeRate, 10000);

    return () => {
      clearInterval(intervalId);
      setIsLoadingRate(false);
      isFetchingRateRef.current = false;
    };
  }, [isLoadingContracts, getExchangeRate, isSwapping, onboardingStatus, isUsingEmbeddedWallet]);

  const executeSwap = async () => {
    console.log('[useSwap] Starting swap...');

    // Clear any previous errors
    setSwapError(null);

    if (!isLoadingContracts || !fromAmount || parseFloat(fromAmount) <= 0) {
      const errorMsg = 'Cannot perform swap: Missing data or invalid amount';
      console.error('[useSwap] Validation failed:', errorMsg);
      setSwapError(errorMsg);
      return;
    }

    setIsSwapping(true);
    setSwapPhase('sending');

    try {
      console.log('[useSwap] Calling swap function...');
      await swap(parseFloat(toAmount), parseFloat(fromAmount) * 1.1, setSwapPhase);
      console.log('[useSwap] Swap completed successfully!');

      // Note: Exchange rate will auto-refresh via the polling effect
      // Note: Parent component should handle clearing amounts by watching isSwapping state

      // Refresh balances after successful swap
      if (!isUsingEmbeddedWallet && currentAddress) {
        try {
          await fetchBalances();
        } catch (err) {
          console.error('Failed to refresh balances after swap:', err);
        }
      }
    } catch (error) {
      console.error('[useSwap] Swap failed - Raw error:', error);

      // Extract error message
      let errorMessage = 'Swap failed. Please try again.';

      try {
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === 'object' && error !== null) {
          const err = error as any;
          if (err.message) {
            errorMessage = err.message;
          } else if (err.error?.message) {
            errorMessage = err.error.message;
          } else if (err.reason) {
            errorMessage = err.reason;
          } else {
            errorMessage = JSON.stringify(error);
          }
        } else if (typeof error === 'string') {
          errorMessage = error;
        }
      } catch (extractError) {
        errorMessage = 'An unexpected error occurred';
      }

      setSwapError(errorMessage);
    } finally {
      setIsSwapping(false);
    }
  };

  const dismissError = () => {
    setSwapError(null);
  };

  // Calculate if swap can be executed
  const canSwap =
    !!fromAmount &&
    parseFloat(fromAmount) > 0 &&
    !isLoadingContracts &&
    onboardingStatus !== 'connecting_wallet' &&
    onboardingStatus !== 'registering_contracts' &&
    onboardingStatus !== 'simulating_queries';

  return {
    fromAmountUSD,
    toAmountUSD,
    exchangeRate,
    isLoadingRate,
    canSwap,
    isSwapping,
    swapPhase,
    swapError,
    executeSwap,
    dismissError,
  };
}
