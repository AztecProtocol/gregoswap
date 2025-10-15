import { createContext, useContext, useState, useEffect, useRef, type ReactNode, useCallback } from 'react';
import {
  AztecAddress,
  BatchCall,
  Fr,
  getContractInstanceFromInstantiationParams,
  ProvenTx,
  type Wallet,
} from '@aztec/aztec.js';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';
import { useWallet } from './WalletContext';
import type { TxProvingResult } from '@aztec/stdlib/tx';

interface ContractsContextType {
  gregoCoin: TokenContract | null;
  gregoCoinPremium: TokenContract | null;
  amm: AMMContract | null;
  isLoading: boolean;
  error: string | null;
  // Utility methods
  getExchangeRate: () => Promise<number>;
  swap: (tokenIn: AztecAddress, tokenOut: AztecAddress, amountOut: number, amountInMax: number) => Promise<void>;
}

const ContractsContext = createContext<ContractsContextType | undefined>(undefined);

export function useContracts() {
  const context = useContext(ContractsContext);
  if (context === undefined) {
    throw new Error('useContracts must be used within a ContractsProvider');
  }
  return context;
}

interface ContractsProviderProps {
  children: ReactNode;
}

// Helper function to get contract registration batch calls
async function getContractRegistrationBatch(wallet: Wallet) {
  const { TokenContractArtifact } = await import('@aztec/noir-contracts.js/Token');
  const { AMMContractArtifact } = await import('@aztec/noir-contracts.js/AMM');
  const gregoCoinAddress = AztecAddress.fromString(import.meta.env.VITE_GREGOCOIN_ADDRESS);
  const gregoCoinPremiumAddress = AztecAddress.fromString(import.meta.env.VITE_GREGOCOIN_PREMIUM_ADDRESS);
  const liquidityTokenAddress = AztecAddress.fromString(import.meta.env.VITE_LIQUIDITY_TOKEN_ADDRESS);
  const contractAddressSalt = Fr.fromString(import.meta.env.VITE_CONTRACT_ADDRESS_SALT);
  const deployerAddress = AztecAddress.fromString(import.meta.env.VITE_DEPLOYER_ADDRESS);

  const [ammInstance, gregoCoinInstance, gregoCoinPremiumInstance] = await Promise.all([
    getContractInstanceFromInstantiationParams(AMMContractArtifact, {
      salt: contractAddressSalt,
      deployer: deployerAddress,
      constructorArgs: [gregoCoinAddress, gregoCoinPremiumAddress, liquidityTokenAddress],
    }),
    getContractInstanceFromInstantiationParams(TokenContractArtifact, {
      salt: contractAddressSalt,
      deployer: deployerAddress,
      constructorArgs: [deployerAddress, 'GregoCoin', 'GRG', 18],
    }),
    getContractInstanceFromInstantiationParams(TokenContractArtifact, {
      salt: contractAddressSalt,
      deployer: deployerAddress,
      constructorArgs: [deployerAddress, 'GregoCoinPremium', 'GRGP', 18],
    }),
  ]);

  return [
    { name: 'registerContract' as const, args: [ammInstance, AMMContractArtifact, undefined] },
    { name: 'registerContract', args: [gregoCoinInstance, TokenContractArtifact, undefined] },
    { name: 'registerContract', args: [gregoCoinPremiumInstance, TokenContractArtifact, undefined] },
  ];
}

export function ContractsProvider({ children }: ContractsProviderProps) {
  const { wallet, currentAddress, isLoading: walletLoading } = useWallet();
  const [gregoCoin, setGregoCoin] = useState<TokenContract | null>(null);
  const [gregoCoinPremium, setGregoCoinPremium] = useState<TokenContract | null>(null);
  const [amm, setAmm] = useState<AMMContract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    // Prevent double initialization in StrictMode
    if (initialized.current) {
      return;
    }

    async function initializeContracts() {
      if (walletLoading || !wallet) {
        setIsLoading(walletLoading);
        return;
      }

      // Mark as initialized only after wallet is ready
      initialized.current = true;

      try {
        setIsLoading(true);
        setError(null);

        console.log('Initializing contracts...');

        // Register contracts using the helper function
        // TODO: Remove 'as unknown as any' when correct types are exported from the library
        const registrationBatch = await getContractRegistrationBatch(wallet);
        await wallet.batch(registrationBatch as unknown as any);

        // Instantiate contracts
        const { TokenContract } = await import('@aztec/noir-contracts.js/Token');
        const { AMMContract } = await import('@aztec/noir-contracts.js/AMM');
        const AMMAddress = AztecAddress.fromString(import.meta.env.VITE_AMM_ADDRESS);
        const gregoCoinAddress = AztecAddress.fromString(import.meta.env.VITE_GREGOCOIN_ADDRESS);
        const gregoCoinPremiumAddress = AztecAddress.fromString(import.meta.env.VITE_GREGOCOIN_PREMIUM_ADDRESS);

        const gregoCoinContract = await TokenContract.at(gregoCoinAddress, wallet);
        const gregoCoinPremiumContract = await TokenContract.at(gregoCoinPremiumAddress, wallet);
        const ammContract = await AMMContract.at(AMMAddress, wallet);

        setGregoCoin(gregoCoinContract);
        setGregoCoinPremium(gregoCoinPremiumContract);
        setAmm(ammContract);

        console.log('Contracts initialized successfully');
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize contracts:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setIsLoading(false);
      }
    }

    initializeContracts();
  }, [wallet, walletLoading]);

  // Utility methods

  const getExchangeRate = async () => {
    if (!amm) throw new Error('AMM contract not initialized');

    const batchCall = new BatchCall(wallet, [
      gregoCoin.methods.balance_of_public(amm.address),
      gregoCoinPremium.methods.balance_of_public(amm.address),
    ]);
    const [token0Reserve, token1Reserve] = await batchCall.simulate({ from: currentAddress });
    return Number(token1Reserve / token0Reserve);
  };

  const swap = useCallback(
    async (tokenIn: AztecAddress, tokenOut: AztecAddress, amountOut: number, amountInMax: number) => {
      if (!wallet) throw new Error('Wallet not initialized');
      if (!amm) throw new Error('AMM contract not initialized');
      if (!currentAddress) throw new Error('No current address set');
      if (!gregoCoin || !gregoCoinPremium) throw new Error('Token contracts not initialized');

      const authwitNonce = Fr.random();
      await amm.methods
        .swap_tokens_for_exact_tokens(
          tokenIn,
          tokenOut,
          BigInt(Math.round(amountOut) * 1e18),
          BigInt(Math.round(amountInMax) * 1e18),
          authwitNonce,
        )
        .send({ from: currentAddress })
        .wait();
    },
    [wallet, amm, currentAddress, gregoCoin, gregoCoinPremium],
  );

  const value: ContractsContextType = {
    gregoCoin,
    gregoCoinPremium,
    amm,
    isLoading,
    error,
    getExchangeRate,
    swap,
  };

  return <ContractsContext.Provider value={value}>{children}</ContractsContext.Provider>;
}
