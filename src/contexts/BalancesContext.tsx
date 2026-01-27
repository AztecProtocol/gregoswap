/**
 * Balances Context
 * Manages token balance state
 */

import { createContext, useContext, useReducer, useCallback, useEffect, type ReactNode } from 'react';
import { useWallet } from './WalletContext';
import { useOnboarding } from './OnboardingContext';
import { useContracts } from './ContractsContext';
import type { Balances, BalancesState, BalancesAction } from '../types';

const initialState: BalancesState = {
  balances: {
    gregoCoin: null,
    gregoCoinPremium: null,
  },
  isLoading: false,
};

function balancesReducer(state: BalancesState, action: BalancesAction): BalancesState {
  switch (action.type) {
    case 'SET_BALANCES':
      return {
        ...state,
        balances: {
          gregoCoin: action.gregoCoin,
          gregoCoinPremium: action.gregoCoinPremium,
        },
        isLoading: false,
      };

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.loading,
      };

    case 'CLEAR':
      return initialState;

    default:
      return state;
  }
}

interface BalancesContextType {
  balances: Balances;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

const BalancesContext = createContext<BalancesContextType | undefined>(undefined);

export function useBalances() {
  const context = useContext(BalancesContext);
  if (context === undefined) {
    throw new Error('useBalances must be used within a BalancesProvider');
  }
  return context;
}

interface BalancesProviderProps {
  children: ReactNode;
}

export function BalancesProvider({ children }: BalancesProviderProps) {
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { onboardingResult } = useOnboarding();
  const { fetchBalances: fetchBalancesFromContracts } = useContracts();
  const [state, dispatch] = useReducer(balancesReducer, initialState);

  // Pre-populate balances from onboarding result when available
  useEffect(() => {
    if (onboardingResult && state.balances.gregoCoin === null && state.balances.gregoCoinPremium === null) {
      dispatch({
        type: 'SET_BALANCES',
        gregoCoin: onboardingResult.balances.gregoCoin,
        gregoCoinPremium: onboardingResult.balances.gregoCoinPremium,
      });
    }
  }, [onboardingResult, state.balances.gregoCoin, state.balances.gregoCoinPremium]);

  // Clear balances when switching to embedded wallet or losing address
  useEffect(() => {
    if (isUsingEmbeddedWallet || !currentAddress) {
      dispatch({ type: 'CLEAR' });
    }
  }, [isUsingEmbeddedWallet, currentAddress]);

  const refetch = useCallback(async () => {
    // Only fetch for non-embedded wallets with an address
    if (isUsingEmbeddedWallet || !currentAddress) {
      dispatch({ type: 'CLEAR' });
      return;
    }

    dispatch({ type: 'SET_LOADING', loading: true });

    try {
      const [gcBalance, gcpBalance] = await fetchBalancesFromContracts();
      dispatch({
        type: 'SET_BALANCES',
        gregoCoin: gcBalance,
        gregoCoinPremium: gcpBalance,
      });
    } catch (err) {
      // Silently fail and clear
      dispatch({ type: 'CLEAR' });
    }
  }, [fetchBalancesFromContracts, currentAddress, isUsingEmbeddedWallet]);

  const value: BalancesContextType = {
    balances: state.balances,
    isLoading: state.isLoading,
    refetch,
  };

  return <BalancesContext.Provider value={value}>{children}</BalancesContext.Provider>;
}
