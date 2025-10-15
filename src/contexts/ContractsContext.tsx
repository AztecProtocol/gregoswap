import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { AztecAddress, BatchCall, Fr, getContractInstanceFromInstantiationParams } from '@aztec/aztec.js';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';
import { useWallet } from './WalletContext';

interface ContractsContextType {
  gregoCoin: TokenContract | null;
  gregoCoinPremium: TokenContract | null;
  amm: AMMContract | null;
  isLoading: boolean;
  error: string | null;
  // Utility methods
  getExchangeRate: () => Promise<number>;
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

export function ContractsProvider({ children }: ContractsProviderProps) {
  const { wallet, node, currentAddress, isLoading: walletLoading } = useWallet();
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

        // Register and instantiate contracts
        const { TokenContract, TokenContractArtifact } = await import('@aztec/noir-contracts.js/Token');
        const { AMMContract, AMMContractArtifact } = await import('@aztec/noir-contracts.js/AMM');
        const AMMAddress = AztecAddress.fromString(import.meta.env.VITE_AMM_ADDRESS);
        const gregoCoinAddress = AztecAddress.fromString(import.meta.env.VITE_GREGOCOIN_ADDRESS);
        const gregoCoinPremiumAddress = AztecAddress.fromString(import.meta.env.VITE_GREGOCOIN_PREMIUM_ADDRESS);
        const liquidityTokenAddress = AztecAddress.fromString(import.meta.env.VITE_LIQUIDITY_TOKEN_ADDRESS);
        const contractAddressSalt = Fr.fromString(import.meta.env.VITE_CONTRACT_ADDRESS_SALT);
        const deployerAddress = AztecAddress.fromString(import.meta.env.VITE_DEPLOYER_ADDRESS);

        console.log('Initializing contracts...');
        console.log('GregoCoin:', gregoCoinAddress.toString());
        console.log('GregoCoinPremium:', gregoCoinPremiumAddress.toString());
        console.log('AMM:', AMMAddress.toString());
        console.log('Contract Address Salt:', contractAddressSalt.toString());
        console.log('Deployer Address:', deployerAddress.toString());

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
          ,
        ]);

        await Promise.all([
          wallet.registerContract(ammInstance, AMMContractArtifact),
          wallet.registerContract(gregoCoinInstance, TokenContractArtifact),
          wallet.registerContract(gregoCoinPremiumInstance, TokenContractArtifact),
        ]);

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

  const value: ContractsContextType = {
    gregoCoin,
    gregoCoinPremium,
    amm,
    isLoading,
    error,
    getExchangeRate,
  };

  return <ContractsContext.Provider value={value}>{children}</ContractsContext.Provider>;
}
