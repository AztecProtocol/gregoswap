import { createContext, useContext, useState, useEffect, useRef, type ReactNode, useCallback } from 'react';
import { EmbeddedWallet } from '../embedded_wallet';
import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ChainInfo } from '@aztec/aztec.js/account';
import { useNetwork } from './NetworkContext';
import { Fr } from '@aztec/aztec.js/fields';
import { WalletManager, type WalletProvider as WalletProviderType } from '@aztec/wallet-sdk/manager';
import { hashToEmoji } from '@aztec/wallet-sdk/crypto';

/**
 * Discovered wallet with verification emoji for anti-MITM protection
 */
export interface DiscoveredWalletWithEmoji {
  provider: WalletProviderType;
  verificationEmoji: string;
}

/**
 * Callback type for wallet disconnect events
 */
export type WalletDisconnectCallback = () => void;

interface WalletContextType {
  wallet: Wallet | null;
  node: AztecNode | null;
  currentAddress: AztecAddress | null;
  isLoading: boolean;
  error: string | null;
  isUsingEmbeddedWallet: boolean;
  /** Discovers available wallet extensions with verification emojis */
  discoverWallets: () => Promise<DiscoveredWalletWithEmoji[]>;
  /** Connects to a specific wallet provider (after user verifies emoji) */
  connectToProvider: (provider: WalletProviderType) => Promise<Wallet>;
  /** Legacy: discovers and connects to first available wallet (no verification) */
  connectWallet: () => Promise<Wallet>;
  setCurrentAddress: (address: AztecAddress | null) => void;
  disconnectWallet: () => Promise<void>;
  /** Register a callback to be notified when the wallet unexpectedly disconnects */
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

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [currentAddress, setCurrentAddress] = useState<AztecAddress | null>(null);
  const [node, setNode] = useState<AztecNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUsingEmbeddedWallet, setIsUsingEmbeddedWallet] = useState(true);

  const embeddedWalletRef = useRef<Wallet | null>(null);
  const embeddedAddressRef = useRef<AztecAddress | null>(null);
  const previousNodeUrlRef = useRef<string | null>(null);
  const hasConnectedExternalWalletRef = useRef(false); // Track if user explicitly connected external wallet

  // Track current provider and disconnect unsubscribe function
  const currentProviderRef = useRef<WalletProviderType | null>(null);
  const providerDisconnectUnsubscribeRef = useRef<(() => void) | null>(null);

  // Callbacks registered by consumers to be notified of unexpected disconnects
  const disconnectCallbacksRef = useRef<Set<WalletDisconnectCallback>>(new Set());

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
    hasConnectedExternalWalletRef.current = false; // Reset when changing networks

    async function initializeWallet() {
      try {
        setIsLoading(true);
        setError(null);

        const aztecNode = createAztecNodeClient(nodeUrl);

        setNode(aztecNode);

        const embeddedWallet = await EmbeddedWallet.create(aztecNode);
        const defaultAccountAddress = (await embeddedWallet.getAccounts())[0]?.item;

        // Store embedded wallet and address for later restoration
        embeddedWalletRef.current = embeddedWallet;
        embeddedAddressRef.current = defaultAccountAddress;

        // Only set embedded wallet as active if user hasn't connected an external wallet
        if (!hasConnectedExternalWalletRef.current) {
          setIsUsingEmbeddedWallet(true);
          setCurrentAddress(defaultAccountAddress);
          setWallet(embeddedWallet);
        }
        setIsLoading(false);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';

        // Add helpful message for connection issues
        const fullError =
          errorMessage.includes('timeout') || errorMessage.includes('unreachable')
            ? `${errorMessage}\n\nIf using local network, make sure Aztec sandbox is running:\n  aztec start --sandbox\n\nThen deploy contracts:\n  yarn deploy:local`
            : errorMessage;

        setError(fullError);
        setIsLoading(false);
      }
    }

    initializeWallet();
  }, [activeNetwork]); // Depend on activeNetwork but check nodeUrl manually

  /**
   * Handles unexpected wallet disconnection.
   * Cleans up provider references and notifies registered callbacks.
   */
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
      setWallet(embeddedWalletRef.current);
      setCurrentAddress(embeddedAddressRef.current);
      setIsUsingEmbeddedWallet(true);
    } else {
      setWallet(null);
      setCurrentAddress(null);
      setIsUsingEmbeddedWallet(true);
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

  /**
   * Discovers available wallet extensions and returns them with verification emojis.
   * The emoji is derived from the ECDH shared secret - both dApp and wallet compute
   * the same emoji independently, allowing users to verify no MITM attack.
   */
  const discoverWallets = useCallback(async (): Promise<DiscoveredWalletWithEmoji[]> => {
    const chainInfo: ChainInfo = {
      chainId: Fr.fromString(activeNetwork.chainId),
      version: Fr.fromString(activeNetwork.rollupVersion),
    };

    const manager = WalletManager.configure({ extensions: { enabled: true } });
    const providers = await manager.getAvailableWallets({ chainInfo, timeout: 2000 });

    // Map providers to include verification emoji
    return providers.map(provider => ({
      provider,
      verificationEmoji: provider.metadata.verificationHash
        ? hashToEmoji(provider.metadata.verificationHash as string)
        : '',
    }));
  }, [activeNetwork]);

  /**
   * Connects to a specific wallet provider after user has verified the emoji.
   */
  const connectToProvider = useCallback(async (provider: WalletProviderType): Promise<Wallet> => {
    // Disconnect from previous provider if any
    if (currentProviderRef.current && currentProviderRef.current.disconnect) {
      // Unsubscribe from previous disconnect callback
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

    const appId = 'gregoswap';
    const extensionWallet = await provider.connect(appId);

    // Store provider reference
    currentProviderRef.current = provider;

    // Register for disconnect events from the provider
    if (provider.onDisconnect) {
      providerDisconnectUnsubscribeRef.current = provider.onDisconnect(handleUnexpectedDisconnect);
    }

    // Mark that user explicitly connected an external wallet
    hasConnectedExternalWalletRef.current = true;

    // Replace the current wallet with extension wallet
    setWallet(extensionWallet);
    setCurrentAddress(null);
    setIsUsingEmbeddedWallet(false);
    return extensionWallet;
  }, [handleUnexpectedDisconnect]);

  /**
   * Legacy: discovers and connects to first available wallet (no verification step).
   * Kept for backwards compatibility.
   */
  const connectWallet = useCallback(async (): Promise<Wallet> => {
    const wallets = await discoverWallets();

    if (wallets.length === 0) {
      throw new Error('No wallet extensions found. Please install a compatible Aztec wallet extension.');
    }

    // Connect to the first available wallet provider
    return connectToProvider(wallets[0].provider);
  }, [discoverWallets, connectToProvider]);

  const disconnectWallet = useCallback(async () => {
    // Unsubscribe from disconnect callback before disconnecting
    if (providerDisconnectUnsubscribeRef.current) {
      providerDisconnectUnsubscribeRef.current();
      providerDisconnectUnsubscribeRef.current = null;
    }

    // Disconnect from current provider
    if (currentProviderRef.current && currentProviderRef.current.disconnect) {
      try {
        await currentProviderRef.current.disconnect();
      } catch (error) {
        console.warn('Error disconnecting wallet:', error);
      }
    }
    currentProviderRef.current = null;

    // Restore embedded wallet and address
    if (embeddedWalletRef.current) {
      hasConnectedExternalWalletRef.current = false; // Reset flag when disconnecting
      setWallet(embeddedWalletRef.current);
      setCurrentAddress(embeddedAddressRef.current);
      setIsUsingEmbeddedWallet(true);
    }
  }, []);

  /**
   * Register a callback to be notified when the wallet unexpectedly disconnects.
   * Returns a function to unregister the callback.
   */
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
    currentAddress,
    wallet,
    node,
    isLoading,
    error,
    isUsingEmbeddedWallet,
    discoverWallets,
    connectToProvider,
    connectWallet,
    setCurrentAddress,
    disconnectWallet,
    onWalletDisconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
