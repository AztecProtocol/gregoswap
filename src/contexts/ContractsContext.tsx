import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from 'react';
import type { TokenContract } from '@aztec/noir-contracts.js/Token';
import type { AMMContract } from '@aztec/noir-contracts.js/AMM';
import { useWallet } from './WalletContext';
import { useNetwork } from './NetworkContext';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { BatchCall, getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import type { ProofOfPasswordContract } from '../../contracts/target/ProofOfPassword.ts';
import { BigDecimal } from '../utils/bigDecimal.ts';
import type { TxReceipt } from '@aztec/stdlib/tx';

interface ContractsContextType {
  isLoadingContracts: boolean;
  // Utility methods
  getExchangeRate: () => Promise<number>;
  swap: (amountOut: number, amountInMax: number) => Promise<TxReceipt>;
  fetchBalances: () => Promise<[bigint, bigint]>;
  simulateOnboardingQueries: () => Promise<[number, bigint, bigint]>;
  registerContractsForFlow: (flowType: 'swap' | 'drip' | 'gregocoin-only') => Promise<void>;
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

// Helper function to get SponsoredFPC contract data
async function getSponsoredFPCData() {
  const { SponsoredFPCContractArtifact } = await import('@aztec/noir-contracts.js/SponsoredFPC');
  const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });
  return { artifact: SponsoredFPCContractArtifact, instance: sponsoredFPCInstance };
}

export function ContractsProvider({ children }: ContractsProviderProps) {
  const { wallet, currentAddress, isLoading: walletLoading, node, isUsingEmbeddedWallet } = useWallet();
  const { activeNetwork } = useNetwork();
  const [gregoCoin, setGregoCoin] = useState<TokenContract | null>(null);
  const [gregoCoinPremium, setGregoCoinPremium] = useState<TokenContract | null>(null);
  const [amm, setAmm] = useState<AMMContract | null>(null);
  const [pop, setPop] = useState<ProofOfPasswordContract | null>(null);
  const [isLoadingContracts, setIsLoadingContracts] = useState(true);

  const drip = useCallback(
    async (password: string, recipient: AztecAddress) => {
      if (!pop) {
        throw new Error('ProofOfPassword contract not initialized');
      }

      const { instance: sponsoredFPCInstance } = await getSponsoredFPCData();

      return pop.methods.check_password_and_mint(password, recipient).send({
        from: AztecAddress.ZERO,
        fee: {
          paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPCInstance.address),
        },
      });
    },
    [wallet, pop],
  );

  const getExchangeRate = useCallback(async () => {
    if (!amm) throw new Error('AMM contract not initialized');

    const batchCall = new BatchCall(wallet, [
      gregoCoin.methods.balance_of_public(amm.address),
      gregoCoinPremium.methods.balance_of_public(amm.address),
    ]);
    const [token0Reserve, token1Reserve] = await batchCall.simulate({ from: currentAddress });
    return parseFloat(new BigDecimal(token1Reserve).divide(new BigDecimal(token0Reserve)).toString());
  }, [amm, wallet, gregoCoin, gregoCoinPremium, currentAddress]);

  const swap = useCallback(
    async (amountOut: number, amountInMax: number) => {
      if (!wallet || !amm || !currentAddress || !gregoCoin || !gregoCoinPremium) {
        throw new Error('Contracts not initialized');
      }

      const authwitNonce = Fr.random();
      return amm.methods
        .swap_tokens_for_exact_tokens(
          gregoCoin.address,
          gregoCoinPremium.address,
          BigInt(Math.round(amountOut)),
          BigInt(Math.round(amountInMax)),
          authwitNonce,
        )
        .send({ from: currentAddress });
    },
    [wallet, amm, currentAddress, gregoCoin, gregoCoinPremium],
  );

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

  const registerContractsForFlow = useCallback(
    async (flowType: 'swap' | 'drip') => {
      if (!wallet || !node) {
        throw new Error('Wallet not initialized');
      }

      const gregoCoinAddress = AztecAddress.fromString(activeNetwork.contracts.gregoCoin);
      const deployerAddress = AztecAddress.fromString(activeNetwork.deployer.address);
      const contractSalt = Fr.fromString(activeNetwork.contracts.salt);

      if (flowType === 'swap') {
        // Register GregoCoin, GregoCoinPremium, and AMM for external wallet onboarding
        setIsLoadingContracts(true);

        const gregoCoinPremiumAddress = AztecAddress.fromString(activeNetwork.contracts.gregoCoinPremium);
        const liquidityTokenAddress = AztecAddress.fromString(activeNetwork.contracts.liquidityToken);
        const ammAddress = AztecAddress.fromString(activeNetwork.contracts.amm);

        // Import contract artifacts
        const { TokenContract, TokenContractArtifact } = await import('@aztec/noir-contracts.js/Token');
        const { AMMContract, AMMContractArtifact } = await import('@aztec/noir-contracts.js/AMM');

        // Reconstruct contract instances using the actual salt from deployment
        const [ammInstance, gregoCoinInstance, gregoCoinPremiumInstance] = await Promise.all([
          getContractInstanceFromInstantiationParams(AMMContractArtifact, {
            salt: contractSalt,
            deployer: deployerAddress,
            constructorArgs: [gregoCoinAddress, gregoCoinPremiumAddress, liquidityTokenAddress],
          }),
          getContractInstanceFromInstantiationParams(TokenContractArtifact, {
            salt: contractSalt,
            deployer: deployerAddress,
            constructorArgs: [deployerAddress, 'GregoCoin', 'GRG', 18],
          }),
          getContractInstanceFromInstantiationParams(TokenContractArtifact, {
            salt: contractSalt,
            deployer: deployerAddress,
            constructorArgs: [deployerAddress, 'GregoCoinPremium', 'GRGP', 18],
          }),
        ]);

        // Register contracts in batch
        await wallet.batch([
          { name: 'registerContract', args: [ammInstance, AMMContractArtifact, undefined] },
          { name: 'registerContract', args: [gregoCoinInstance, TokenContractArtifact, undefined] },
          { name: 'registerContract', args: [gregoCoinPremiumInstance, undefined, undefined] },
        ]);

        // After registration, instantiate the contracts
        const gregoCoinContract = TokenContract.at(gregoCoinAddress, wallet);
        const gregoCoinPremiumContract = TokenContract.at(gregoCoinPremiumAddress, wallet);
        const ammContract = AMMContract.at(ammAddress, wallet);

        setGregoCoin(gregoCoinContract);
        setGregoCoinPremium(gregoCoinPremiumContract);
        setAmm(ammContract);

        setIsLoadingContracts(false);
      } else {
        // Register ProofOfPassword and SponsoredFPC for drip flow
        setIsLoadingContracts(true);

        const popAddress = AztecAddress.fromString(activeNetwork.contracts.pop);
        const { ProofOfPasswordContract, ProofOfPasswordContractArtifact } = await import(
          '../../contracts/target/ProofOfPassword.ts'
        );

        const instance = await node.getContract(popAddress);
        const { instance: sponsoredFPCInstance, artifact: SponsoredFPCContractArtifact } = await getSponsoredFPCData();

        await wallet.batch([
          { name: 'registerContract', args: [instance, ProofOfPasswordContractArtifact, undefined] },
          { name: 'registerContract', args: [sponsoredFPCInstance, SponsoredFPCContractArtifact, undefined] },
        ]);

        // After registration, instantiate the ProofOfPassword contract
        const popContract = ProofOfPasswordContract.at(popAddress, wallet);
        setPop(popContract);

        setIsLoadingContracts(false);
      }
    },
    [wallet, node, activeNetwork],
  );

  // Initialize contracts for embedded wallet (external wallets register during onboarding)
  useEffect(() => {
    async function initializeContracts() {
      if (walletLoading || !wallet) {
        setIsLoadingContracts(walletLoading);
        return;
      }

      // For external wallets, don't initialize until onboarding registers contracts
      if (!isUsingEmbeddedWallet) {
        return;
      }

      try {
        // Use registerContractsForFlow to avoid code duplication
        await registerContractsForFlow('swap');
      } catch (err) {
        setIsLoadingContracts(false);
      }
    }

    initializeContracts();
  }, [wallet, walletLoading, isUsingEmbeddedWallet, registerContractsForFlow]);

  const value: ContractsContextType = {
    isLoadingContracts,
    getExchangeRate,
    swap,
    fetchBalances,
    simulateOnboardingQueries,
    registerContractsForFlow,
    drip,
  };

  return <ContractsContext.Provider value={value}>{children}</ContractsContext.Provider>;
}
