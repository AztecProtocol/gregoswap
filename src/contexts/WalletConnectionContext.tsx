/**
 * Wallet Connection Context
 * Manages the wallet discovery and connection flow state machine
 */

import { createContext, useContext, useReducer, useCallback, useRef, type ReactNode } from 'react';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { WalletProvider, PendingConnection, DiscoverySession } from '@aztec/wallet-sdk/manager';
import { useNetwork } from './NetworkContext';
import { useWallet } from './WalletContext';
import * as walletService from '../services/walletService';
import type {
  WalletConnectionPhase,
  WalletConnectionState,
  WalletConnectionAction,
} from '../types';

// =============================================================================
// Reducer
// =============================================================================

const initialState: WalletConnectionState = {
  phase: 'idle',
  discoveredWallets: [],
  cancelledWalletIds: new Set(),
  selectedWallet: null,
  pendingConnection: null,
  accounts: [],
  error: null,
};

function walletConnectionReducer(
  state: WalletConnectionState,
  action: WalletConnectionAction
): WalletConnectionState {
  switch (action.type) {
    case 'START_DISCOVERY':
      return {
        ...initialState,
        phase: 'discovering',
        // Preserve cancelled wallet ids from previous discovery
        cancelledWalletIds: state.cancelledWalletIds,
      };

    case 'ADD_WALLET':
      // Don't add if already in list or cancelled
      if (
        state.discoveredWallets.some(w => w.id === action.wallet.id) ||
        state.cancelledWalletIds.has(action.wallet.id)
      ) {
        return state;
      }
      return {
        ...state,
        phase: state.phase === 'discovering' ? 'selecting' : state.phase,
        discoveredWallets: [...state.discoveredWallets, action.wallet],
      };

    case 'SELECT_WALLET':
      return {
        ...state,
        phase: 'verifying',
        selectedWallet: action.wallet,
      };

    case 'SET_PENDING_CONNECTION':
      return {
        ...state,
        pendingConnection: action.connection,
      };

    case 'SET_ACCOUNTS':
      return {
        ...state,
        phase: 'account_select',
        accounts: action.accounts,
      };

    case 'SET_PHASE':
      return {
        ...state,
        phase: action.phase,
      };

    case 'CANCEL_WALLET':
      return {
        ...state,
        phase: state.discoveredWallets.length > 1 ? 'selecting' : 'discovering',
        selectedWallet: null,
        pendingConnection: null,
        cancelledWalletIds: new Set([...state.cancelledWalletIds, action.walletId]),
        discoveredWallets: state.discoveredWallets.filter(w => w.id !== action.walletId),
      };

    case 'SET_ERROR':
      return {
        ...state,
        phase: 'error',
        error: action.error,
      };

    case 'RESET':
      return {
        ...initialState,
        // Clear cancelled wallets on full reset
        cancelledWalletIds: new Set(),
      };

    default:
      return state;
  }
}

// =============================================================================
// Context
// =============================================================================

interface WalletConnectionContextType extends WalletConnectionState {
  // Actions
  startDiscovery: (timeout?: number) => void;
  cancelDiscovery: () => void;
  selectWallet: (provider: WalletProvider) => Promise<void>;
  confirmConnection: () => Promise<Wallet>;
  cancelConnection: () => void;
  selectAccount: (address: AztecAddress) => void;
  reset: () => void;
}

const WalletConnectionContext = createContext<WalletConnectionContextType | undefined>(undefined);

export function useWalletConnection() {
  const context = useContext(WalletConnectionContext);
  if (context === undefined) {
    throw new Error('useWalletConnection must be used within a WalletConnectionProvider');
  }
  return context;
}

// =============================================================================
// Provider
// =============================================================================

interface WalletConnectionProviderProps {
  children: ReactNode;
}

export function WalletConnectionProvider({ children }: WalletConnectionProviderProps) {
  const { activeNetwork } = useNetwork();
  const { setCurrentAddress } = useWallet();
  const [state, dispatch] = useReducer(walletConnectionReducer, initialState);

  // Track active discovery session
  const activeDiscoveryRef = useRef<DiscoverySession | null>(null);

  // Start wallet discovery
  const startDiscovery = useCallback(
    (timeout?: number) => {
      // Cancel any existing discovery
      if (activeDiscoveryRef.current) {
        activeDiscoveryRef.current.cancel();
      }

      dispatch({ type: 'START_DISCOVERY' });

      const chainInfo = walletService.getChainInfo(activeNetwork);
      const discovery = walletService.discoverWallets(chainInfo, timeout);
      activeDiscoveryRef.current = discovery;

      // Process discovered wallets
      (async () => {
        try {
          for await (const wallet of discovery.wallets) {
            dispatch({ type: 'ADD_WALLET', wallet });
          }
        } catch (error) {
          // Discovery was cancelled or errored
          if (error instanceof Error && !error.message.includes('cancelled')) {
            dispatch({ type: 'SET_ERROR', error: error.message });
          }
        }
      })();
    },
    [activeNetwork]
  );

  // Cancel discovery
  const cancelDiscovery = useCallback(() => {
    if (activeDiscoveryRef.current) {
      activeDiscoveryRef.current.cancel();
      activeDiscoveryRef.current = null;
    }
  }, []);

  // Select a wallet and initiate connection
  const selectWallet = useCallback(async (provider: WalletProvider) => {
    dispatch({ type: 'SELECT_WALLET', wallet: provider });

    try {
      const pendingConnection = await walletService.initiateConnection(provider);
      dispatch({ type: 'SET_PENDING_CONNECTION', connection: pendingConnection });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: error instanceof Error ? error.message : 'Failed to initiate connection',
      });
    }
  }, []);

  // Confirm connection after emoji verification
  const confirmConnectionAction = useCallback(async (): Promise<Wallet> => {
    if (!state.pendingConnection || !state.selectedWallet) {
      throw new Error('No pending connection to confirm');
    }

    dispatch({ type: 'SET_PHASE', phase: 'connecting' });

    try {
      const wallet = await walletService.confirmConnection(state.pendingConnection);

      // Get accounts from the wallet
      const accounts = await wallet.getAccounts();
      dispatch({ type: 'SET_ACCOUNTS', accounts });

      return wallet;
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: error instanceof Error ? error.message : 'Failed to confirm connection',
      });
      throw error;
    }
  }, [state.pendingConnection, state.selectedWallet]);

  // Cancel connection and go back to wallet selection
  const cancelConnectionAction = useCallback(() => {
    if (state.pendingConnection) {
      walletService.cancelConnection(state.pendingConnection);
    }

    if (state.selectedWallet) {
      dispatch({ type: 'CANCEL_WALLET', walletId: state.selectedWallet.id });
    } else {
      dispatch({ type: 'SET_PHASE', phase: 'selecting' });
    }
  }, [state.pendingConnection, state.selectedWallet]);

  // Select an account from the wallet
  const selectAccount = useCallback(
    (address: AztecAddress) => {
      setCurrentAddress(address);
      dispatch({ type: 'RESET' });
    },
    [setCurrentAddress]
  );

  // Reset all state
  const reset = useCallback(() => {
    cancelDiscovery();
    dispatch({ type: 'RESET' });
  }, [cancelDiscovery]);

  const value: WalletConnectionContextType = {
    ...state,
    startDiscovery,
    cancelDiscovery,
    selectWallet,
    confirmConnection: confirmConnectionAction,
    cancelConnection: cancelConnectionAction,
    selectAccount,
    reset,
  };

  return (
    <WalletConnectionContext.Provider value={value}>
      {children}
    </WalletConnectionContext.Provider>
  );
}
