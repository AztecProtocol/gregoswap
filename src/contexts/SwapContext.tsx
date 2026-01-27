/**
 * Swap Context
 * Manages swap UI state and execution
 */

import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useContracts } from './ContractsContext';
import { useWallet } from './WalletContext';
import { useOnboarding } from './OnboardingContext';
import { useBalances } from './BalancesContext';
import type { SwapState, SwapAction } from '../types';
import { GREGOCOIN_USD_PRICE, EXCHANGE_RATE_POLL_INTERVAL_MS } from '../types';

const initialState: SwapState = {
  fromAmount: '',
  toAmount: '',
  exchangeRate: null,
  isLoadingRate: false,
  phase: 'idle',
  error: null,
};

function swapReducer(state: SwapState, action: SwapAction): SwapState {
  switch (action.type) {
    case 'SET_FROM_AMOUNT':
      return {
        ...state,
        fromAmount: action.amount,
      };

    case 'SET_TO_AMOUNT':
      return {
        ...state,
        toAmount: action.amount,
      };

    case 'SET_RATE':
      return {
        ...state,
        exchangeRate: action.rate,
        isLoadingRate: false,
      };

    case 'SET_LOADING_RATE':
      return {
        ...state,
        isLoadingRate: action.loading,
      };

    case 'START_SWAP':
      return {
        ...state,
        phase: 'sending',
        error: null,
      };

    case 'SWAP_MINING':
      return {
        ...state,
        phase: 'mining',
      };

    case 'SWAP_SUCCESS':
      return {
        ...state,
        phase: 'success',
        fromAmount: '',
        toAmount: '',
      };

    case 'SWAP_ERROR':
      return {
        ...state,
        phase: 'error',
        error: action.error,
      };

    case 'DISMISS_ERROR':
      return {
        ...state,
        phase: 'idle',
        error: null,
      };

    case 'RESET':
      return {
        ...initialState,
        exchangeRate: state.exchangeRate, // Preserve exchange rate
      };

    default:
      return state;
  }
}

interface SwapContextType extends SwapState {
  // Computed values
  fromAmountUSD: number;
  toAmountUSD: number;
  canSwap: boolean;
  isSwapping: boolean;

  // Actions
  setFromAmount: (amount: string) => void;
  setToAmount: (amount: string) => void;
  executeSwap: () => Promise<void>;
  dismissError: () => void;
  reset: () => void;
}

const SwapContext = createContext<SwapContextType | undefined>(undefined);

export function useSwap() {
  const context = useContext(SwapContext);
  if (context === undefined) {
    throw new Error('useSwap must be used within a SwapProvider');
  }
  return context;
}

interface SwapProviderProps {
  children: ReactNode;
}

export function SwapProvider({ children }: SwapProviderProps) {
  const { swap, isLoadingContracts, getExchangeRate } = useContracts();
  const { currentAddress } = useWallet();
  const { status: onboardingStatus, onboardingResult, isSwapPending, isDripPending, clearSwapPending } = useOnboarding();
  const { refetch: refetchBalances } = useBalances();
  const [state, dispatch] = useReducer(swapReducer, initialState);

  // Refs for rate fetching and orchestration
  const isFetchingRateRef = useRef(false);
  const hasUsedOnboardingResultRef = useRef(false);
  const swapTriggeredRef = useRef(false);
  const prevExchangeRateRef = useRef<number | null>(null);

  // Computed value used by multiple effects
  const isSwapping = state.phase === 'sending' || state.phase === 'mining';

  // Internal swap execution (for use in effects)
  const doSwap = useCallback(async () => {
    if (isLoadingContracts || !state.fromAmount || parseFloat(state.fromAmount) <= 0) {
      dispatch({ type: 'SWAP_ERROR', error: 'Cannot perform swap: Missing data or invalid amount' });
      return;
    }

    dispatch({ type: 'START_SWAP' });

    try {
      await swap(parseFloat(state.toAmount), parseFloat(state.fromAmount) * 1.1);
      dispatch({ type: 'SWAP_SUCCESS' });
    } catch (error) {
      let errorMessage = 'Swap failed. Please try again.';

      if (error instanceof Error) {
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

      dispatch({ type: 'SWAP_ERROR', error: errorMessage });
    }
  }, [isLoadingContracts, state.fromAmount, state.toAmount, swap]);

  // Pre-populate exchange rate from onboarding result
  useEffect(() => {
    if (onboardingResult && !hasUsedOnboardingResultRef.current) {
      dispatch({ type: 'SET_RATE', rate: onboardingResult.exchangeRate });
      hasUsedOnboardingResultRef.current = true;
    }
  }, [onboardingResult]);

  // Execute swap when onboarding completes with pending swap
  useEffect(() => {
    if (onboardingStatus === 'completed' && isSwapPending && !swapTriggeredRef.current) {
      swapTriggeredRef.current = true;
      doSwap();
    }
  }, [onboardingStatus, isSwapPending, doSwap]);

  // Clear pending flag after swap completes
  useEffect(() => {
    if (swapTriggeredRef.current && isSwapPending && !isSwapping) {
      swapTriggeredRef.current = false;
      clearSwapPending();
    }
  }, [isSwapPending, isSwapping, clearSwapPending]);

  // Refresh balances after successful swap
  useEffect(() => {
    if (state.phase === 'success') {
      refetchBalances();
      const timer = setTimeout(() => dispatch({ type: 'RESET' }), 1000);
      return () => clearTimeout(timer);
    }
  }, [state.phase, refetchBalances]);

  // Recalculate amounts when exchange rate becomes available
  useEffect(() => {
    const wasUnavailable = prevExchangeRateRef.current === null;
    const isNowAvailable = state.exchangeRate !== null;

    if (wasUnavailable && isNowAvailable) {
      if (state.fromAmount !== '' && state.toAmount === '') {
        const numValue = parseFloat(state.fromAmount);
        if (!isNaN(numValue)) {
          dispatch({ type: 'SET_TO_AMOUNT', amount: (numValue * state.exchangeRate).toFixed(6) });
        }
      } else if (state.toAmount !== '' && state.fromAmount === '') {
        const numValue = parseFloat(state.toAmount);
        if (!isNaN(numValue)) {
          dispatch({ type: 'SET_FROM_AMOUNT', amount: (numValue / state.exchangeRate).toFixed(6) });
        }
      }
    }

    prevExchangeRateRef.current = state.exchangeRate;
  }, [state.exchangeRate, state.fromAmount, state.toAmount]);

  // Reset exchange rate when contracts are loading
  useEffect(() => {
    if (isLoadingContracts) {
      dispatch({ type: 'SET_LOADING_RATE', loading: false });
      isFetchingRateRef.current = false;
    }
  }, [isLoadingContracts]);

  // Fetch exchange rate with auto-refresh
  useEffect(() => {
    async function fetchExchangeRate() {
      const isSwapping = state.phase === 'sending' || state.phase === 'mining';
      const isBusy = isLoadingContracts || isSwapping || isSwapPending || isDripPending;
      const isOnboardingInProgress = onboardingStatus !== 'completed' && onboardingStatus !== 'idle';

      if (isBusy || isOnboardingInProgress) {
        dispatch({ type: 'SET_LOADING_RATE', loading: false });
        return;
      }

      if (isFetchingRateRef.current) {
        return;
      }

      try {
        isFetchingRateRef.current = true;
        dispatch({ type: 'SET_LOADING_RATE', loading: true });

        const rate = await getExchangeRate();
        dispatch({ type: 'SET_RATE', rate });
      } finally {
        dispatch({ type: 'SET_LOADING_RATE', loading: false });
        isFetchingRateRef.current = false;
      }
    }

    fetchExchangeRate();

    const intervalId = setInterval(() => {
      fetchExchangeRate();
    }, EXCHANGE_RATE_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      dispatch({ type: 'SET_LOADING_RATE', loading: false });
      isFetchingRateRef.current = false;
    };
  }, [isLoadingContracts, state.phase, isDripPending, getExchangeRate, onboardingStatus, isSwapPending]);

  // Amount change handlers with recalculation
  const setFromAmount = useCallback(
    (value: string) => {
      dispatch({ type: 'SET_FROM_AMOUNT', amount: value });

      if (value === '' || state.exchangeRate === null) {
        dispatch({ type: 'SET_TO_AMOUNT', amount: '' });
      } else {
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          dispatch({ type: 'SET_TO_AMOUNT', amount: (numValue * state.exchangeRate).toFixed(6) });
        }
      }
    },
    [state.exchangeRate]
  );

  const setToAmount = useCallback(
    (value: string) => {
      dispatch({ type: 'SET_TO_AMOUNT', amount: value });

      if (value === '' || state.exchangeRate === null) {
        dispatch({ type: 'SET_FROM_AMOUNT', amount: '' });
      } else {
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          dispatch({ type: 'SET_FROM_AMOUNT', amount: (numValue / state.exchangeRate).toFixed(6) });
        }
      }
    },
    [state.exchangeRate]
  );

  const dismissError = useCallback(() => {
    dispatch({ type: 'DISMISS_ERROR' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // Computed values
  const fromAmountUSD = state.fromAmount ? parseFloat(state.fromAmount) * GREGOCOIN_USD_PRICE : 0;
  const toAmountUSD = state.toAmount ? parseFloat(state.toAmount) * GREGOCOIN_USD_PRICE : 0;

  const canSwap =
    !!state.fromAmount &&
    parseFloat(state.fromAmount) > 0 &&
    !isLoadingContracts &&
    (onboardingStatus === 'idle' || onboardingStatus === 'completed');

  const value: SwapContextType = {
    ...state,
    fromAmountUSD,
    toAmountUSD,
    canSwap,
    isSwapping,
    setFromAmount,
    setToAmount,
    executeSwap: doSwap,
    dismissError,
    reset,
  };

  return <SwapContext.Provider value={value}>{children}</SwapContext.Provider>;
}
