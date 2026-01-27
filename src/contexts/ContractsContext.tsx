/**
 * Contracts Context
 * Manages contract instances and registration state
 */

import { createContext, useContext, useReducer, useEffect, type ReactNode, useCallback } from 'react';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { TxReceipt } from '@aztec/stdlib/tx';
import { Fr } from '@aztec/aztec.js/fields';
import { useWallet } from './WalletContext';
import { useNetwork } from './NetworkContext';
import * as contractService from '../services/contractService';
import * as dripService from '../services/dripService';
import type { ContractsState, ContractsAction, ContractRegistrationStage } from '../types';

const initialState: ContractsState = {
  contracts: {
    gregoCoin: null,
    gregoCoinPremium: null,
    amm: null,
    pop: null,
  },
  registeredStages: new Set(),
  isLoading: true,
};

function contractsReducer(state: ContractsState, action: ContractsAction): ContractsState {
  switch (action.type) {
    case 'REGISTER_START':
      return {
        ...state,
        isLoading: true,
      };

    case 'REGISTER_SUCCESS':
      return {
        ...state,
        contracts: {
          ...state.contracts,
          ...action.contracts,
        },
        registeredStages: new Set([...state.registeredStages, action.stage]),
        isLoading: false,
      };

    case 'REGISTER_FAIL':
      return {
        ...state,
        isLoading: false,
      };

    case 'CLEAR':
      return initialState;

    default:
      return state;
  }
}

interface ContractsContextType {
  isLoadingContracts: boolean;
  registeredStages: Set<ContractRegistrationStage>;

  // Registration methods
  registerBaseContracts: () => Promise<void>;
  registerDripContracts: () => Promise<void>;

  // Utility methods
  getExchangeRate: () => Promise<number>;
  swap: (amountOut: number, amountInMax: number) => Promise<TxReceipt>;
  fetchBalances: () => Promise<[bigint, bigint]>;
  simulateOnboardingQueries: () => Promise<[number, bigint, bigint]>;
  drip: (password: string, recipient: AztecAddress) => Promise<TxReceipt>;
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
  const { wallet, currentAddress, isLoading: walletLoading, node, isUsingEmbeddedWallet } = useWallet();
  const { activeNetwork } = useNetwork();
  const [state, dispatch] = useReducer(contractsReducer, initialState);

  // Register base contracts (AMM, tokens)
  const registerBaseContracts = useCallback(async () => {
    if (!wallet || !node) {
      throw new Error('Wallet not initialized');
    }

    dispatch({ type: 'REGISTER_START' });

    try {
      const swapContracts = await contractService.registerSwapContracts(wallet, node, activeNetwork);
      dispatch({
        type: 'REGISTER_SUCCESS',
        stage: 'base',
        contracts: swapContracts,
      });
    } catch (error) {
      dispatch({ type: 'REGISTER_FAIL', error: error instanceof Error ? error.message : 'Registration failed' });
      throw error;
    }
  }, [wallet, node, activeNetwork]);

  // Register drip contracts (ProofOfPassword)
  const registerDripContracts = useCallback(async () => {
    if (!wallet || !node) {
      throw new Error('Wallet not initialized');
    }

    dispatch({ type: 'REGISTER_START' });

    try {
      const dripContracts = await contractService.registerDripContracts(wallet, node, activeNetwork);
      dispatch({
        type: 'REGISTER_SUCCESS',
        stage: 'drip',
        contracts: dripContracts,
      });
    } catch (error) {
      dispatch({ type: 'REGISTER_FAIL', error: error instanceof Error ? error.message : 'Registration failed' });
      throw error;
    }
  }, [wallet, node, activeNetwork]);

  // Get exchange rate
  const getExchangeRate = useCallback(async (): Promise<number> => {
    if (!wallet || !state.contracts.amm || !state.contracts.gregoCoin || !state.contracts.gregoCoinPremium) {
      throw new Error('Contracts not initialized');
    }

    return contractService.getExchangeRate(
      wallet,
      {
        gregoCoin: state.contracts.gregoCoin,
        gregoCoinPremium: state.contracts.gregoCoinPremium,
        amm: state.contracts.amm,
      },
      currentAddress!,
    );
  }, [wallet, state.contracts, currentAddress]);

  // Execute swap
  const swap = useCallback(
    async (amountOut: number, amountInMax: number): Promise<TxReceipt> => {
      if (
        !wallet ||
        !currentAddress ||
        !state.contracts.amm ||
        !state.contracts.gregoCoin ||
        !state.contracts.gregoCoinPremium
      ) {
        throw new Error('Contracts not initialized');
      }

      const authwitNonce = Fr.random();

      return state.contracts.amm.methods
        .swap_tokens_for_exact_tokens(
          state.contracts.gregoCoin.address,
          state.contracts.gregoCoinPremium.address,
          BigInt(Math.round(amountOut)),
          BigInt(Math.round(amountInMax)),
          authwitNonce,
        )
        .send({ from: currentAddress });
    },
    [wallet, currentAddress, state.contracts],
  );

  // Fetch balances
  const fetchBalances = useCallback(async (): Promise<[bigint, bigint]> => {
    if (!wallet || !currentAddress || !state.contracts.gregoCoin || !state.contracts.gregoCoinPremium) {
      throw new Error('Contracts not initialized');
    }

    return contractService.fetchBalances(
      wallet,
      {
        gregoCoin: state.contracts.gregoCoin,
        gregoCoinPremium: state.contracts.gregoCoinPremium,
        amm: state.contracts.amm!,
      },
      currentAddress,
    );
  }, [wallet, currentAddress, state.contracts]);

  // Simulate onboarding queries
  const simulateOnboardingQueries = useCallback(async (): Promise<[number, bigint, bigint]> => {
    if (
      !wallet ||
      !currentAddress ||
      !state.contracts.amm ||
      !state.contracts.gregoCoin ||
      !state.contracts.gregoCoinPremium
    ) {
      throw new Error('Contracts not initialized');
    }

    const result = await contractService.simulateOnboardingQueries(
      wallet,
      {
        gregoCoin: state.contracts.gregoCoin,
        gregoCoinPremium: state.contracts.gregoCoinPremium,
        amm: state.contracts.amm,
      },
      currentAddress,
    );

    return [result.exchangeRate, result.balances.gregoCoin, result.balances.gregoCoinPremium];
  }, [wallet, currentAddress, state.contracts]);

  // Execute drip
  const drip = useCallback(
    async (password: string, recipient: AztecAddress): Promise<TxReceipt> => {
      if (!state.contracts.pop) {
        throw new Error('ProofOfPassword contract not initialized');
      }

      return dripService.executeDrip(state.contracts.pop, password, recipient);
    },
    [state.contracts.pop],
  );

  // Initialize contracts for embedded wallet
  useEffect(() => {
    async function initializeContracts() {
      if (walletLoading || !wallet) {
        dispatch({ type: 'REGISTER_START' });
        return;
      }

      // For external wallets, don't initialize until onboarding registers contracts
      if (!isUsingEmbeddedWallet) {
        return;
      }

      try {
        await registerBaseContracts();
      } catch (err) {
        dispatch({ type: 'REGISTER_FAIL', error: err instanceof Error ? err.message : 'Failed to initialize' });
      }
    }

    initializeContracts();
  }, [wallet, walletLoading, isUsingEmbeddedWallet, registerBaseContracts]);

  const value: ContractsContextType = {
    isLoadingContracts: state.isLoading,
    registeredStages: state.registeredStages,
    registerBaseContracts,
    registerDripContracts,
    getExchangeRate,
    swap,
    fetchBalances,
    simulateOnboardingQueries,
    drip,
  };

  return <ContractsContext.Provider value={value}>{children}</ContractsContext.Provider>;
}
