import { createContext, useContext, useState, useEffect, useRef, type ReactNode, useCallback } from 'react';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';
import { useWallet } from './WalletContext';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { BatchCall, getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';

class BigDecimal {
  // Configuration: private constants
  static #DECIMALS = 18; // Number of decimals on all instances
  static #SHIFT = 10n ** BigInt(BigDecimal.#DECIMALS); // Derived constant
  static #fromBigInt = Symbol(); // Secret to allow construction with given #n value
  #n; // the BigInt that will hold the BigDecimal's value multiplied by #SHIFT
  constructor(value, convert?) {
    if (value instanceof BigDecimal) return value;
    if (convert === BigDecimal.#fromBigInt) {
      // Can only be used within this class
      this.#n = value;
      return;
    }
    const [ints, decis] = String(value).split('.').concat('');
    this.#n = BigInt(ints + decis.padEnd(BigDecimal.#DECIMALS, '0').slice(0, BigDecimal.#DECIMALS));
  }
  divide(num) {
    return new BigDecimal((this.#n * BigDecimal.#SHIFT) / new BigDecimal(num).#n, BigDecimal.#fromBigInt);
  }
  toString() {
    let s = this.#n
      .toString()
      .replace('-', '')
      .padStart(BigDecimal.#DECIMALS + 1, '0');
    s = (s.slice(0, -BigDecimal.#DECIMALS) + '.' + s.slice(-BigDecimal.#DECIMALS)).replace(/(\.0*|0+)$/, '');
    return this.#n < 0 ? '-' + s : s;
  }
}

interface ContractsContextType {
  gregoCoin: TokenContract | null;
  gregoCoinPremium: TokenContract | null;
  amm: AMMContract | null;
  isLoading: boolean;
  error: string | null;
  gregoCoinBalance: bigint | null;
  gregoCoinPremiumBalance: bigint | null;
  isLoadingBalances: boolean;
  // Utility methods
  getExchangeRate: () => Promise<number>;
  swap: (tokenIn: AztecAddress, tokenOut: AztecAddress, amountOut: number, amountInMax: number) => Promise<void>;
  fetchBalances: () => Promise<void>;
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
  const [gregoCoinBalance, setGregoCoinBalance] = useState<bigint | null>(null);
  const [gregoCoinPremiumBalance, setGregoCoinPremiumBalance] = useState<bigint | null>(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const lastWallet = useRef<Wallet | null>(null);

  useEffect(() => {
    async function initializeContracts() {
      if (walletLoading || !wallet) {
        setIsLoading(walletLoading);
        return;
      }

      // Reinitialize if wallet instance changed
      if (lastWallet.current === wallet) {
        // Same wallet instance, skip initialization
        return;
      }

      lastWallet.current = wallet;

      try {
        setIsLoading(true);
        setError(null);

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
    return parseFloat(new BigDecimal(token1Reserve).divide(new BigDecimal(token0Reserve)).toString());
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
          BigInt(Math.round(amountOut)),
          BigInt(Math.round(amountInMax)),
          authwitNonce,
        )
        .send({ from: currentAddress })
        .wait();
    },
    [wallet, amm, currentAddress, gregoCoin, gregoCoinPremium],
  );

  const fetchBalances = useCallback(async () => {
    if (!wallet || !gregoCoin || !gregoCoinPremium || !currentAddress) {
      return;
    }

    try {
      setIsLoadingBalances(true);
      const batchCall = new BatchCall(wallet, [
        gregoCoin.methods.balance_of_private(currentAddress),
        gregoCoinPremium.methods.balance_of_private(currentAddress),
      ]);
      const [gcBalance, gcpBalance] = await batchCall.simulate({ from: currentAddress });
      setGregoCoinBalance(gcBalance);
      setGregoCoinPremiumBalance(gcpBalance);
    } catch (err) {
      console.error('Failed to fetch balances:', err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [wallet, gregoCoin, gregoCoinPremium, currentAddress]);

  const value: ContractsContextType = {
    gregoCoin,
    gregoCoinPremium,
    amm,
    isLoading,
    error,
    gregoCoinBalance,
    gregoCoinPremiumBalance,
    isLoadingBalances,
    getExchangeRate,
    swap,
    fetchBalances,
  };

  return <ContractsContext.Provider value={value}>{children}</ContractsContext.Provider>;
}
