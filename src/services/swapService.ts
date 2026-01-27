/**
 * Swap Service
 * Pure functions for swap-related operations
 */

import type { Wallet } from '@aztec/aztec.js/wallet';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import type { TxReceipt } from '@aztec/stdlib/tx';
import type { SwapContracts } from './contractService';

/**
 * Executes a token swap through the AMM
 * @param wallet - The wallet to execute the swap from
 * @param contracts - The swap contracts
 * @param fromAddress - The address executing the swap
 * @param amountOut - The exact amount of output tokens desired
 * @param amountInMax - The maximum amount of input tokens to spend
 * @returns The transaction receipt
 */
export async function executeSwap(
  wallet: Wallet,
  contracts: SwapContracts,
  fromAddress: AztecAddress,
  amountOut: number,
  amountInMax: number
): Promise<TxReceipt> {
  const { gregoCoin, gregoCoinPremium, amm } = contracts;

  const authwitNonce = Fr.random();
  return amm.methods
    .swap_tokens_for_exact_tokens(
      gregoCoin.address,
      gregoCoinPremium.address,
      BigInt(Math.round(amountOut)),
      BigInt(Math.round(amountInMax)),
      authwitNonce
    )
    .send({ from: fromAddress });
}

/**
 * Parses a swap error into a user-friendly message
 */
export function parseSwapError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Swap failed. Please try again.';
  }

  const message = error.message;

  if (message.includes('Simulation failed')) {
    return message;
  }
  if (message.includes('User denied') || message.includes('rejected')) {
    return 'Transaction was rejected in wallet';
  }
  if (message.includes('Insufficient') || message.includes('insufficient')) {
    return 'Insufficient GregoCoin balance for swap';
  }

  return message;
}
