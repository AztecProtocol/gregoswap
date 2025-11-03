import { useState, useCallback, useEffect, useRef } from 'react';
import { useContracts } from '../contexts/ContractsContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { waitForTxWithPhases } from '../utils/txUtils';

interface UseSwapProps {
  fromAmount: string;
  toAmount: string;
  isDripping?: boolean;
  fromTokenBalance?: bigint | null;
}

interface UseSwapReturn {
  // Exchange rate
  exchangeRate: number | undefined;
  isLoadingRate: boolean;

  // USD values
  fromAmountUSD: number;
  toAmountUSD: number;

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

export function useSwap({ fromAmount, toAmount, isDripping = false, fromTokenBalance = null }: UseSwapProps): UseSwapReturn {
  // Pull from contexts
  const { swap, isLoadingContracts, getExchangeRate } = useContracts();
  const { status: onboardingStatus, onboardingResult, isSwapPending } = useOnboarding();

  // State for swap
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapPhase, setSwapPhase] = useState<'sending' | 'mining'>('sending');
  const [swapError, setSwapError] = useState<string | null>(null);

  // State for exchange rate
  const [exchangeRate, setExchangeRate] = useState<number | undefined>(undefined);
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const isFetchingRateRef = useRef(false);

  // Pre-populate exchange rate from onboarding result when available (only once)
  const hasUsedOnboardingResultRef = useRef(false);
  useEffect(() => {
    if (onboardingResult && !hasUsedOnboardingResultRef.current) {
      setExchangeRate(onboardingResult.exchangeRate);
      hasUsedOnboardingResultRef.current = true;
    }
  }, [onboardingResult]);

  // Reset exchange rate when contracts are loading (e.g., network switch)
  useEffect(() => {
    if (isLoadingContracts) {
      setExchangeRate(undefined);
      setIsLoadingRate(false);
      isFetchingRateRef.current = false;
    }
  }, [isLoadingContracts]);

  // Track previous isSwapping state to detect swap completion
  const prevIsSwappingRef = useRef(isSwapping);
  useEffect(() => {
    const wasSwapping = prevIsSwappingRef.current;
    const justFinishedSwapping = wasSwapping && !isSwapping;

    if (justFinishedSwapping && !swapError) {
      // Swap just completed successfully - force immediate exchange rate refresh
      isFetchingRateRef.current = false; // Allow new fetch
      // The main fetch effect will pick this up on next render
    }

    prevIsSwappingRef.current = isSwapping;
  }, [isSwapping, swapError]);

  // Fetch exchange rate with auto-refresh every 10 seconds
  useEffect(() => {
    async function fetchExchangeRate() {
      const isBusy = isLoadingContracts || isSwapping || isSwapPending || isDripping;
      const isOnboardingInProgress = onboardingStatus !== 'completed' && onboardingStatus !== 'not_started';

      if (isBusy || isOnboardingInProgress) {
        setIsLoadingRate(false);
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
      } finally {
        setIsLoadingRate(false);

        isFetchingRateRef.current = false;
      }
    }

    fetchExchangeRate();

    // Set up interval for subsequent fetches
    const intervalId = setInterval(() => {
      fetchExchangeRate();
    }, 10000);

    return () => {
      clearInterval(intervalId);
      setIsLoadingRate(false);
      isFetchingRateRef.current = false;
    };
  }, [
    isLoadingContracts,
    isSwapping,
    isDripping,
    getExchangeRate,
    onboardingStatus,
    isSwapPending,
    swapError, // Include to trigger refresh after swap completes
  ]);

  // Calculate USD values (simplified - just based on amount)
  const fromAmountUSD = fromAmount ? parseFloat(fromAmount) * GREGOCOIN_USD_PRICE : 0;
  const toAmountUSD = toAmount ? parseFloat(toAmount) * GREGOCOIN_USD_PRICE : 0;

  const executeSwap = useCallback(async () => {
    setSwapError(null);

    if (isLoadingContracts || !fromAmount || parseFloat(fromAmount) <= 0) {
      setSwapError('Cannot perform swap: Missing data or invalid amount');
      return;
    }

    // Check if FROM amount exceeds balance
    if (fromTokenBalance !== null && fromTokenBalance !== undefined) {
      const fromAmountBigInt = BigInt(Math.round(parseFloat(fromAmount)));
      if (fromAmountBigInt > fromTokenBalance) {
        setSwapError('Insufficient GregoCoin balance for swap');
        return;
      }
    }

    setIsSwapping(true);
    setSwapPhase('sending');

    try {
      const sentTx = await swap(parseFloat(toAmount), parseFloat(fromAmount) * 1.1);
      await waitForTxWithPhases(sentTx, setSwapPhase);
    } catch (error) {
      let errorMessage = 'Swap failed. Please try again.';

      if (error instanceof Error) {
        // Check for common error patterns and enhance messages
        if (error.message.includes('Simulation failed')) {
          errorMessage = error.message;
        } else if (error.message.includes('User denied') || error.message.includes('rejected')) {
          errorMessage = 'Transaction was rejected in wallet';
        } else if (error.message.includes('Insufficient') || error.message.includes('insufficient')) {
          errorMessage = 'Insufficient GregoCoin balance for swap';
        } else {
          errorMessage = error.message;
        }
      }

      setSwapError(errorMessage);
    } finally {
      setIsSwapping(false);
    }
  }, [isLoadingContracts, fromAmount, toAmount, swap, fromTokenBalance]);

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
    exchangeRate,
    isLoadingRate,
    fromAmountUSD,
    toAmountUSD,
    canSwap,
    isSwapping,
    swapPhase,
    swapError,
    executeSwap,
    dismissError,
  };
}
