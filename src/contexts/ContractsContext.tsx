import { createContext, useContext, useState, useEffect, useRef, type ReactNode, useCallback } from 'react';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';
import { useWallet } from './WalletContext';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { BatchCall, getContractInstanceFromInstantiationParams, type SentTx } from '@aztec/aztec.js/contracts';

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
  isLoadingContracts: boolean;
  // Utility methods
  getExchangeRate: () => Promise<number>;
  swap: (amountOut: number, amountInMax: number) => Promise<SentTx>;
  fetchBalances: () => Promise<[bigint, bigint]>;
  simulateOnboardingQueries: () => Promise<[number, bigint, bigint]>;
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
async function getContractRegistrationBatch() {
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
  const [isLoadingContracts, setIsLoadingContracts] = useState(true);
  const lastWallet = useRef<Wallet | null>(null);

  useEffect(() => {
    async function initializeContracts() {
      if (walletLoading || !wallet) {
        setIsLoadingContracts(walletLoading);
        return;
      }

      // Reinitialize if wallet instance changed
      if (lastWallet.current === wallet) {
        // Same wallet instance, skip initialization
        return;
      }

      lastWallet.current = wallet;

      try {
        setIsLoadingContracts(true);
        // Register contracts using the helper function
        // TODO: Remove 'as unknown as any' when correct types are exported from the library
        const registrationBatch = await getContractRegistrationBatch();
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

        setIsLoadingContracts(false);
      } catch (err) {
        console.error('Failed to initialize contracts:', err);
        setIsLoadingContracts(false);
      }
    }

    initializeContracts();
  }, [wallet, walletLoading]);

  // Utility methods

  const getExchangeRate = useCallback(async () => {
    if (!amm) throw new Error('AMM contract not initialized');

    const batchCall = new BatchCall(wallet, [
      gregoCoin.methods.balance_of_public(amm.address),
      gregoCoinPremium.methods.balance_of_public(amm.address),
    ]);
    const [token0Reserve, token1Reserve] = await batchCall.simulate({ from: currentAddress });
    return parseFloat(new BigDecimal(token1Reserve).divide(new BigDecimal(token0Reserve)).toString());
  }, [amm, wallet, gregoCoin, gregoCoinPremium, currentAddress]);

  const swap = useCallback(async (amountOut: number, amountInMax: number) => {
    if (!wallet || !amm || !currentAddress || !gregoCoin || !gregoCoinPremium) {
      throw new Error('Contracts not initialized');
    }

    const authwitNonce = Fr.random();
    const sentTx = await amm.methods
      .swap_tokens_for_exact_tokens(
        gregoCoin.address,
        gregoCoinPremium.address,
        BigInt(Math.round(amountOut)),
        BigInt(Math.round(amountInMax)),
        authwitNonce,
      )
      .send({ from: currentAddress });

    return sentTx;
  }, [wallet, amm, currentAddress, gregoCoin, gregoCoinPremium]);

  const fetchBalances = useCallback(async () => {
    if (!wallet || !gregoCoin || !gregoCoinPremium || !currentAddress) {
      return;
    }

    const batchCall = new BatchCall(wallet, [
      gregoCoin.methods.balance_of_private(currentAddress),
      gregoCoinPremium.methods.balance_of_private(currentAddress),
    ]);
    const [gcBalance, gcpBalance] = await batchCall.simulate({ from: currentAddress });
    return [gcBalance, gcpBalance] as [bigint, bigint];
  }, [wallet, gregoCoin, gregoCoinPremium, currentAddress]);

  const simulateOnboardingQueries = useCallback(async () => {
    if (!wallet || !gregoCoin || !gregoCoinPremium || !amm || !currentAddress) {
      throw new Error('Contracts not initialized');
    }

    // Create a batched simulation that includes:
    // 1. Exchange rate data (public balances of AMM)
    // 2. User's private balances
    // This triggers wallet approval for these queries, so future reads are seamless
    const batchCall = new BatchCall(wallet, [
      gregoCoin.methods.balance_of_public(amm.address),
      gregoCoinPremium.methods.balance_of_public(amm.address),
      gregoCoin.methods.balance_of_private(currentAddress),
      gregoCoinPremium.methods.balance_of_private(currentAddress),
    ]);

    const [token0Reserve, token1Reserve, gcBalance, gcpBalance] = await batchCall.simulate({ from: currentAddress });
    const exchangeRate = parseFloat(new BigDecimal(token1Reserve).divide(new BigDecimal(token0Reserve)).toString());
    return [exchangeRate, gcBalance, gcpBalance] as [number, bigint, bigint];
  }, [wallet, gregoCoin, gregoCoinPremium, amm, currentAddress]);

  const value: ContractsContextType = {
    isLoadingContracts,
    getExchangeRate,
    swap,
    fetchBalances,
    simulateOnboardingQueries,
  };

  return <ContractsContext.Provider value={value}>{children}</ContractsContext.Provider>;
}
