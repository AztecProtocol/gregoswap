import { createContext, useContext, useState, useEffect, useRef, type ReactNode, useCallback } from 'react';
import { EmbeddedWallet } from '../embedded_wallet';
import { ExtensionWallet } from '../extension_wallet';
import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ChainInfo } from '@aztec/aztec.js/account';

interface WalletContextType {
  wallet: Wallet | null;
  node: AztecNode | null;
  currentAddress: AztecAddress | null;
  isLoading: boolean;
  error: string | null;
  isUsingEmbeddedWallet: boolean;
  connectWallet: (chainInfo: ChainInfo) => Promise<Wallet>;
  setCurrentAddress: (address: AztecAddress | null) => void;
  disconnectWallet: () => void;
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
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [currentAddress, setCurrentAddress] = useState<AztecAddress | null>(null);
  const [node, setNode] = useState<AztecNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUsingEmbeddedWallet, setIsUsingEmbeddedWallet] = useState(true);
  const initialized = useRef(false);
  const embeddedWalletRef = useRef<Wallet | null>(null);
  const embeddedAddressRef = useRef<AztecAddress | null>(null);

  useEffect(() => {
    // Prevent double initialization in StrictMode
    if (initialized.current) {
      return;
    }
    initialized.current = true;

    async function initializeWallet() {
      try {
        setIsLoading(true);
        setError(null);

        // Get the node URL from environment variables
        const nodeUrl = import.meta.env.VITE_AZTEC_NODE_URL;

        if (!nodeUrl) {
          throw new Error('VITE_AZTEC_NODE_URL is not defined in environment variables');
        }

        const aztecNode = createAztecNodeClient(nodeUrl);
        setNode(aztecNode);

        const embeddedWallet = await EmbeddedWallet.create(aztecNode);
        const defaultAccountAddress = (await embeddedWallet.getAccounts())[0]?.item;

        // Store embedded wallet and address for later restoration
        embeddedWalletRef.current = embeddedWallet;
        embeddedAddressRef.current = defaultAccountAddress;

        setCurrentAddress(defaultAccountAddress);
        setWallet(embeddedWallet);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize wallet:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setIsLoading(false);
      }
    }

    initializeWallet();
  }, []);

  const connectWallet = useCallback(async (chainInfo: ChainInfo): Promise<Wallet> => {
    const appId = 'gregoswap';
    const extensionWallet = ExtensionWallet.create(chainInfo, appId);

    // Replace the current wallet with extension wallet
    setWallet(extensionWallet);
    setCurrentAddress(null);
    setIsUsingEmbeddedWallet(false);
    return extensionWallet;
  }, []);

  const disconnectWallet = useCallback(() => {
    // Restore embedded wallet and address
    if (embeddedWalletRef.current) {
      setWallet(embeddedWalletRef.current);
      setCurrentAddress(embeddedAddressRef.current);
      setIsUsingEmbeddedWallet(true);
    }
  }, []);

  const value: WalletContextType = {
    currentAddress,
    wallet,
    node,
    isLoading,
    error,
    isUsingEmbeddedWallet,
    connectWallet,
    setCurrentAddress,
    disconnectWallet,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
