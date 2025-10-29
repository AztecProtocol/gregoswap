import { useState, useCallback, useEffect, useRef } from 'react';
import { useContracts } from '../contexts/ContractsContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { useWallet } from '../contexts/WalletContext';
import { waitForTxWithPhases } from '../utils/txUtils';

interface UseSwapProps {
  fromAmount: string;
  toAmount: string;
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

export function useSwap({ fromAmount, toAmount }: UseSwapProps): UseSwapReturn {
  // Pull from contexts
  const { swap, isLoadingContracts, getExchangeRate } = useContracts();
  const { status: onboardingStatus } = useOnboarding();
  const { isUsingEmbeddedWallet, currentAddress } = useWallet();

  // State for swap
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapPhase, setSwapPhase] = useState<'sending' | 'mining'>('sending');
  const [swapError, setSwapError] = useState<string | null>(null);

  // State for exchange rate
  const [exchangeRate, setExchangeRate] = useState<number | undefined>(undefined);
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const isFetchingRateRef = useRef(false);

  // Fetch exchange rate with auto-refresh every 10 seconds
  useEffect(() => {
    async function fetchExchangeRate() {
      const shouldPause =
        isLoadingContracts ||
        isSwapping ||
        onboardingStatus === 'connecting_wallet' ||
        onboardingStatus === 'simulating_queries' ||
        onboardingStatus === 'registering_contracts' ||
        (!isUsingEmbeddedWallet && currentAddress !== null && onboardingStatus !== 'completed');

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
  }, [isLoadingContracts, isSwapping, getExchangeRate, onboardingStatus, isUsingEmbeddedWallet, currentAddress]);

  // Calculate USD values (simplified - just based on amount)
  const fromAmountUSD = fromAmount ? parseFloat(fromAmount) * GREGOCOIN_USD_PRICE : 0;
  const toAmountUSD = toAmount ? parseFloat(toAmount) * GREGOCOIN_USD_PRICE : 0;

  const executeSwap = useCallback(async () => {
    setSwapError(null);

    if (isLoadingContracts || !fromAmount || parseFloat(fromAmount) <= 0) {
      setSwapError('Cannot perform swap: Missing data or invalid amount');
      return;
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
          errorMessage = 'Insufficient balance for swap';
        } else {
          errorMessage = error.message;
        }
      }

      setSwapError(errorMessage);
    } finally {
      setIsSwapping(false);
    }
  }, [isLoadingContracts, fromAmount, toAmount, swap]);

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
