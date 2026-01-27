/**
 * Wallet Context
 * Manages wallet instances (embedded vs external) and current address
 * Connection flow logic has been extracted to WalletConnectionContext
 */

import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode, useCallback } from 'react';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { WalletProvider, PendingConnection, DiscoverySession } from '@aztec/wallet-sdk/manager';
import { useNetwork } from './NetworkContext';
import * as walletService from '../services/walletService';
import type { WalletState, WalletAction } from '../types';

const initialState: WalletState = {
  wallet: null,
  node: null,
  currentAddress: null,
  isUsingEmbeddedWallet: true,
  isLoading: true,
  error: null,
};

function walletReducer(state: WalletState, action: WalletAction): WalletState {
  switch (action.type) {
    case 'INIT_START':
      return {
        ...state,
        isLoading: true,
        error: null,
      };

    case 'INIT_EMBEDDED':
      return {
        ...state,
        wallet: action.wallet,
        node: action.node,
        currentAddress: action.address,
        isUsingEmbeddedWallet: true,
        isLoading: false,
        error: null,
      };

    case 'SET_EXTERNAL':
      return {
        ...state,
        wallet: action.wallet,
        currentAddress: null, // Will be set when account is selected
        isUsingEmbeddedWallet: false,
      };

    case 'SET_ADDRESS':
      return {
        ...state,
        currentAddress: action.address,
      };

    case 'DISCONNECT':
      return {
        ...state,
        wallet: null,
        currentAddress: null,
        isUsingEmbeddedWallet: true,
      };

    case 'RESTORE_EMBEDDED':
      return {
        ...state,
        wallet: action.wallet,
        currentAddress: action.address,
        isUsingEmbeddedWallet: true,
      };

    case 'SET_ERROR':
      return {
        ...state,
        isLoading: false,
        error: action.error,
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

export type WalletDisconnectCallback = () => void;

interface WalletContextType {
  wallet: Wallet | null;
  node: AztecNode | null;
  currentAddress: AztecAddress | null;
  isLoading: boolean;
  error: string | null;
  isUsingEmbeddedWallet: boolean;

  // Wallet discovery and connection (delegated to WalletConnectionContext for UI)
  // These are kept here for backward compatibility during migration
  discoverWallets: (timeout?: number) => DiscoverySession;
  initiateConnection: (provider: WalletProvider) => Promise<PendingConnection>;
  confirmConnection: (provider: WalletProvider, pendingConnection: PendingConnection) => Promise<Wallet>;
  cancelConnection: (pendingConnection: PendingConnection) => void;

  // State management
  setCurrentAddress: (address: AztecAddress | null) => void;
  setExternalWallet: (wallet: Wallet) => void;
  disconnectWallet: () => Promise<void>;
  onWalletDisconnect: (callback: WalletDisconnectCallback) => () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const { activeNetwork } = useNetwork();
  const [state, dispatch] = useReducer(walletReducer, initialState);

  // Refs for embedded wallet restoration and provider tracking
  const embeddedWalletRef = useRef<Wallet | null>(null);
  const embeddedAddressRef = useRef<AztecAddress | null>(null);
  const previousNodeUrlRef = useRef<string | null>(null);
  const hasConnectedExternalWalletRef = useRef(false);

  // Provider tracking for disconnect handling
  const currentProviderRef = useRef<WalletProvider | null>(null);
  const providerDisconnectUnsubscribeRef = useRef<(() => void) | null>(null);
  const activeDiscoveryRef = useRef<DiscoverySession | null>(null);
  const disconnectCallbacksRef = useRef<Set<WalletDisconnectCallback>>(new Set());

  // Initialize embedded wallet when network changes
  useEffect(() => {
    const nodeUrl = activeNetwork?.nodeUrl;

    if (!nodeUrl) {
      return;
    }

    // Only initialize if nodeUrl has actually changed
    if (previousNodeUrlRef.current === nodeUrl) {
      return;
    }

    previousNodeUrlRef.current = nodeUrl;
    hasConnectedExternalWalletRef.current = false;

    async function initializeWallet() {
      try {
        dispatch({ type: 'INIT_START' });

        const node = walletService.createNodeClient(nodeUrl);
        const embeddedWallet = await walletService.createEmbeddedWallet(node);
        const accounts = await embeddedWallet.getAccounts();
        const defaultAccountAddress = accounts[0]?.item;

        // Store embedded wallet for later restoration
        embeddedWalletRef.current = embeddedWallet;
        embeddedAddressRef.current = defaultAccountAddress;

        // Only set embedded wallet as active if user hasn't connected an external wallet
        if (!hasConnectedExternalWalletRef.current) {
          dispatch({
            type: 'INIT_EMBEDDED',
            wallet: embeddedWallet,
            node,
            address: defaultAccountAddress,
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';

        const fullError =
          errorMessage.includes('timeout') || errorMessage.includes('unreachable')
            ? `${errorMessage}\n\nIf using local network, make sure Aztec sandbox is running:\n  aztec start --sandbox\n\nThen deploy contracts:\n  yarn deploy:local`
            : errorMessage;

        dispatch({ type: 'SET_ERROR', error: fullError });
      }
    }

    initializeWallet();
  }, [activeNetwork]);

  // Handle unexpected wallet disconnection
  const handleUnexpectedDisconnect = useCallback(() => {
    console.log('Wallet disconnected unexpectedly');

    // Clean up provider references
    if (providerDisconnectUnsubscribeRef.current) {
      providerDisconnectUnsubscribeRef.current();
      providerDisconnectUnsubscribeRef.current = null;
    }
    currentProviderRef.current = null;

    // Reset wallet state - restore embedded wallet
    hasConnectedExternalWalletRef.current = false;
    if (embeddedWalletRef.current) {
      dispatch({
        type: 'RESTORE_EMBEDDED',
        wallet: embeddedWalletRef.current,
        address: embeddedAddressRef.current,
      });
    } else {
      dispatch({ type: 'DISCONNECT' });
    }

    // Notify all registered callbacks
    for (const callback of disconnectCallbacksRef.current) {
      try {
        callback();
      } catch {
        // Ignore errors in callbacks
      }
    }
  }, []);

  // Wallet discovery (kept for backward compatibility)
  const discoverWallets = useCallback(
    (timeout?: number): DiscoverySession => {
      if (activeDiscoveryRef.current) {
        activeDiscoveryRef.current.cancel();
      }

      const chainInfo = walletService.getChainInfo(activeNetwork);
      const discovery = walletService.discoverWallets(chainInfo, timeout);

      activeDiscoveryRef.current = discovery;
      return discovery;
    },
    [activeNetwork]
  );

  // Initiate connection
  const initiateConnection = useCallback(async (provider: WalletProvider): Promise<PendingConnection> => {
    // Disconnect from previous provider if any
    if (currentProviderRef.current && currentProviderRef.current.disconnect) {
      if (providerDisconnectUnsubscribeRef.current) {
        providerDisconnectUnsubscribeRef.current();
        providerDisconnectUnsubscribeRef.current = null;
      }
      try {
        await currentProviderRef.current.disconnect();
      } catch (error) {
        console.warn('Error disconnecting previous wallet:', error);
      }
    }

    return walletService.initiateConnection(provider);
  }, []);

  // Confirm connection
  const confirmConnection = useCallback(
    async (provider: WalletProvider, pendingConnection: PendingConnection): Promise<Wallet> => {
      const extensionWallet = await walletService.confirmConnection(pendingConnection);

      // Store provider reference
      currentProviderRef.current = provider;

      // Register for disconnect events
      if (provider.onDisconnect) {
        providerDisconnectUnsubscribeRef.current = provider.onDisconnect(handleUnexpectedDisconnect);
      }

      // Mark that user explicitly connected an external wallet
      hasConnectedExternalWalletRef.current = true;

      // Update state
      dispatch({ type: 'SET_EXTERNAL', wallet: extensionWallet });

      return extensionWallet;
    },
    [handleUnexpectedDisconnect]
  );

  // Cancel connection
  const cancelConnection = useCallback((pendingConnection: PendingConnection): void => {
    walletService.cancelConnection(pendingConnection);
  }, []);

  // Set current address
  const setCurrentAddress = useCallback((address: AztecAddress | null) => {
    dispatch({ type: 'SET_ADDRESS', address });
  }, []);

  // Set external wallet (called from WalletConnectionContext)
  const setExternalWallet = useCallback(
    (wallet: Wallet) => {
      hasConnectedExternalWalletRef.current = true;
      dispatch({ type: 'SET_EXTERNAL', wallet });
    },
    []
  );

  // Disconnect wallet
  const disconnectWallet = useCallback(async () => {
    // Unsubscribe from disconnect callback before disconnecting
    if (providerDisconnectUnsubscribeRef.current) {
      providerDisconnectUnsubscribeRef.current();
      providerDisconnectUnsubscribeRef.current = null;
    }

    // Disconnect from current provider
    if (currentProviderRef.current) {
      try {
        await walletService.disconnectProvider(currentProviderRef.current);
      } catch (error) {
        console.warn('Error disconnecting wallet:', error);
      }
    }
    currentProviderRef.current = null;

    // Restore embedded wallet
    if (embeddedWalletRef.current) {
      hasConnectedExternalWalletRef.current = false;
      dispatch({
        type: 'RESTORE_EMBEDDED',
        wallet: embeddedWalletRef.current,
        address: embeddedAddressRef.current,
      });
    }
  }, []);

  // Register disconnect callback
  const onWalletDisconnect = useCallback((callback: WalletDisconnectCallback): (() => void) => {
    disconnectCallbacksRef.current.add(callback);
    return () => {
      disconnectCallbacksRef.current.delete(callback);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (providerDisconnectUnsubscribeRef.current) {
        providerDisconnectUnsubscribeRef.current();
      }
    };
  }, []);

  const value: WalletContextType = {
    wallet: state.wallet,
    node: state.node,
    currentAddress: state.currentAddress,
    isLoading: state.isLoading,
    error: state.error,
    isUsingEmbeddedWallet: state.isUsingEmbeddedWallet,
    discoverWallets,
    initiateConnection,
    confirmConnection,
    cancelConnection,
    setCurrentAddress,
    setExternalWallet,
    disconnectWallet,
    onWalletDisconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
