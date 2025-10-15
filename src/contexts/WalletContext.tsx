import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { AztecAddress, createAztecNodeClient, type AztecNode, type Wallet } from '@aztec/aztec.js';
import { EmbeddedWallet } from '../embedded_wallet';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';

interface WalletContextType {
  wallet: Wallet | null;
  node: AztecNode | null;
  currentAddress: AztecAddress | null;
  isLoading: boolean;
  error: string | null;
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

  useEffect(() => {
    async function initializeWallet() {
      try {
        setIsLoading(true);
        setError(null);

        // Get the node URL from environment variables
        const nodeUrl = import.meta.env.VITE_AZTEC_NODE_URL;

        if (!nodeUrl) {
          throw new Error('VITE_AZTEC_NODE_URL is not defined in environment variables');
        }

        console.log('Connecting to Aztec node at:', nodeUrl);
        const aztecNode = createAztecNodeClient(nodeUrl);
        const embeddedWallet = await EmbeddedWallet.create(aztecNode);
        const defaultAccountAddress = (await embeddedWallet.getAccounts())[0]?.item || (await AztecAddress.random());
        setCurrentAddress(defaultAccountAddress);
        setNode(aztecNode);
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

  const value: WalletContextType = {
    currentAddress,
    wallet,
    node,
    isLoading,
    error,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
