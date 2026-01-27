/**
 * Drip Context
 * Manages drip (token faucet) execution state
 */

import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useContracts } from './ContractsContext';
import { useWallet } from './WalletContext';
import { useOnboarding } from './OnboardingContext';
import { useBalances } from './BalancesContext';
import type { DripState, DripAction } from '../types';

const initialState: DripState = {
  phase: 'idle',
  error: null,
};

function dripReducer(state: DripState, action: DripAction): DripState {
  switch (action.type) {
    case 'START_DRIP':
      return {
        phase: 'sending',
        error: null,
      };

    case 'DRIP_MINING':
      return {
        ...state,
        phase: 'mining',
      };

    case 'DRIP_SUCCESS':
      return {
        phase: 'success',
        error: null,
      };

    case 'DRIP_ERROR':
      return {
        phase: 'error',
        error: action.error,
      };

    case 'DISMISS_ERROR':
      return {
        phase: 'idle',
        error: null,
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

interface DripContextType extends DripState {
  // Computed
  isDripping: boolean;

  // Actions
  executeDrip: (password: string) => Promise<void>;
  dismissError: () => void;
  reset: () => void;
}

const DripContext = createContext<DripContextType | undefined>(undefined);

export function useDrip() {
  const context = useContext(DripContext);
  if (context === undefined) {
    throw new Error('useDrip must be used within a DripProvider');
  }
  return context;
}

interface DripProviderProps {
  children: ReactNode;
}

export function DripProvider({ children }: DripProviderProps) {
  const { drip } = useContracts();
  const { currentAddress } = useWallet();
  const { isDripPending, dripPassword, completeDripExecution, clearDripPassword } = useOnboarding();
  const { refetch: refetchBalances } = useBalances();
  const [state, dispatch] = useReducer(dripReducer, initialState);

  const dripTriggeredRef = useRef(false);
  const isDripping = state.phase === 'sending' || state.phase === 'mining';

  const executeDrip = useCallback(
    async (password: string) => {
      if (!currentAddress) {
        dispatch({ type: 'DRIP_ERROR', error: 'No address selected' });
        return;
      }

      dispatch({ type: 'START_DRIP' });

      try {
        await drip(password, currentAddress);
        dispatch({ type: 'DRIP_SUCCESS' });
      } catch (error) {
        let errorMessage = 'Failed to claim GregoCoin. Please try again.';

        if (error instanceof Error) {
          if (error.message.includes('Simulation failed')) {
            errorMessage = error.message;
          } else if (error.message.includes('User denied') || error.message.includes('rejected')) {
            errorMessage = 'Transaction was rejected in wallet';
          } else if (error.message.includes('password') || error.message.includes('Password')) {
            errorMessage = 'Invalid password. Please try again.';
          } else if (error.message.includes('already claimed') || error.message.includes('Already claimed')) {
            errorMessage = 'You have already claimed your GregoCoin tokens.';
          } else {
            errorMessage = error.message;
          }
        }

        dispatch({ type: 'DRIP_ERROR', error: errorMessage });
      }
    },
    [drip, currentAddress]
  );

  const dismissError = useCallback(() => {
    dispatch({ type: 'DISMISS_ERROR' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // Execute drip when password is provided during onboarding
  useEffect(() => {
    async function handleDrip() {
      if (!isDripPending || !dripPassword || isDripping || dripTriggeredRef.current) {
        return;
      }

      dripTriggeredRef.current = true;
      completeDripExecution();
      clearDripPassword();

      try {
        await executeDrip(dripPassword);
        refetchBalances();
      } catch {
        // Error is handled by executeDrip
      } finally {
        dripTriggeredRef.current = false;
      }
    }

    handleDrip();
  }, [isDripPending, dripPassword, isDripping, completeDripExecution, clearDripPassword, executeDrip, refetchBalances]);

  const value: DripContextType = {
    ...state,
    isDripping,
    executeDrip,
    dismissError,
    reset,
  };

  return <DripContext.Provider value={value}>{children}</DripContext.Provider>;
}
