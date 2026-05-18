/**
 * Wallet Context
 * Manages wallet instances (embedded vs external) and current address
 * Connection flow logic has been extracted to WalletConnectionContext
 */

import { createContext, useContext, useEffect, useRef, type ReactNode, useCallback } from 'react';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { WalletProvider, PendingConnection, DiscoverySession } from '@aztec/wallet-sdk/manager';
import { useNetwork } from '../network';
import * as walletService from '../../services/walletService';
import { useWalletReducer } from './reducer';

export type WalletDisconnectCallback = () => void;

interface WalletContextType {
  wallet: Wallet | null;
  node: AztecNode | null;
  currentAddress: AztecAddress | null;
  isLoading: boolean;
  error: string | null;
  isUsingEmbeddedWallet: boolean;
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

  const [state, actions] = useWalletReducer();

  // Refs for embedded wallet restoration and provider tracking
  const embeddedWalletRef = useRef<Wallet | null>(null);
  const embeddedAddressRef = useRef<AztecAddress | null>(null);
  const previousNodeUrlRef = useRef<string | null>(null);
  const hasConnectedExternalWalletRef = useRef(false);
  // Generation counter. A stale createEmbeddedWallet resolving after a network switch
  // checks this to skip overwriting current state.
  const initIdRef = useRef(0);

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
    // Drop the previous network's embedded wallet so it can't be restored on the new network.
    embeddedWalletRef.current = null;
    embeddedAddressRef.current = null;
    const initId = ++initIdRef.current;

    async function initializeWallet() {
      try {
        actions.initStart();

        // Node is a property of the network, not the wallet. Publish it immediately so
        // external-wallet flows don't have to wait on the slow embedded init.
        const node = walletService.createNodeClient(nodeUrl);
        actions.setNode(node);

        const { wallet: embeddedWallet, address: defaultAccountAddress } = await walletService.createEmbeddedWallet(node);

        // Bail if a newer init has superseded this one (e.g. user switched network mid-init).
        if (initId !== initIdRef.current) return;

        embeddedWalletRef.current = embeddedWallet;
        embeddedAddressRef.current = defaultAccountAddress;

        if (!hasConnectedExternalWalletRef.current) {
          actions.initEmbedded(embeddedWallet, node, defaultAccountAddress);
        }
      } catch (err) {
        if (initId !== initIdRef.current) return;

        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';

        // External wallet already connected. Embedded init failures here are background
        // noise; don't clobber the working session with a fatal error.
        if (hasConnectedExternalWalletRef.current) {
          console.warn('Embedded wallet init failed (external wallet active):', errorMessage);
          return;
        }

        const fullError =
          errorMessage.includes('timeout') || errorMessage.includes('unreachable')
            ? `${errorMessage}\n\nIf using local network, make sure Aztec sandbox is running:\n  aztec start --sandbox\n\nThen deploy contracts:\n  yarn deploy:local`
            : errorMessage;

        actions.setError(fullError);
      }
    }

    initializeWallet();
  }, [activeNetwork, actions]);

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
      actions.restoreEmbedded(embeddedWalletRef.current, embeddedAddressRef.current);
    } else {
      actions.disconnect();
    }

    // Notify all registered callbacks
    for (const callback of disconnectCallbacksRef.current) {
      try {
        callback();
      } catch {
        // Ignore errors in callbacks
      }
    }
  }, [actions]);

  // Wallet discovery
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
    [activeNetwork],
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
      actions.setExternal(extensionWallet);

      return extensionWallet;
    },
    [handleUnexpectedDisconnect, actions],
  );

  // Cancel connection
  const cancelConnection = useCallback((pendingConnection: PendingConnection): void => {
    walletService.cancelConnection(pendingConnection);
  }, []);

  // Set current address
  const setCurrentAddress = useCallback(
    (address: AztecAddress | null) => {
      actions.setAddress(address);
    },
    [actions],
  );

  // Set external wallet (called from WalletConnectionContext)
  const setExternalWallet = useCallback(
    (wallet: Wallet) => {
      hasConnectedExternalWalletRef.current = true;
      actions.setExternal(wallet);
    },
    [actions],
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

    // Restore embedded wallet if available; otherwise clear state so the UI doesn't
    // keep showing the disconnected external wallet as active.
    hasConnectedExternalWalletRef.current = false;
    if (embeddedWalletRef.current) {
      actions.restoreEmbedded(embeddedWalletRef.current, embeddedAddressRef.current);
    } else {
      actions.disconnect();
    }
  }, [actions]);

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
