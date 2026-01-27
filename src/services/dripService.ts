/**
 * Drip Service
 * Pure functions for drip (token faucet) operations
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { AztecAddress as AztecAddressClass } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import type { TxReceipt } from '@aztec/stdlib/tx';
import type { ProofOfPasswordContract } from '../../contracts/target/ProofOfPassword';

/**
 * Helper function to get SponsoredFPC contract data
 */
async function getSponsoredFPCData() {
  const { SponsoredFPCContractArtifact } = await import('@aztec/noir-contracts.js/SponsoredFPC');
  const sponsoredFPCInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });
  return { artifact: SponsoredFPCContractArtifact, instance: sponsoredFPCInstance };
}

/**
 * Executes a drip (token claim) transaction
 * @param pop - The ProofOfPassword contract instance
 * @param password - The password to verify
 * @param recipient - The address to receive the tokens
 * @returns The transaction receipt
 */
export async function executeDrip(
  pop: ProofOfPasswordContract,
  password: string,
  recipient: AztecAddress
): Promise<TxReceipt> {
  const { instance: sponsoredFPCInstance } = await getSponsoredFPCData();

  return pop.methods.check_password_and_mint(password, recipient).send({
    from: AztecAddressClass.ZERO,
    fee: {
      paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPCInstance.address),
    },
  });
}

/**
 * Parses a drip error into a user-friendly message
 */
export function parseDripError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Failed to claim GregoCoin. Please try again.';
  }

  const message = error.message;

  if (message.includes('Simulation failed')) {
    return message;
  }
  if (message.includes('User denied') || message.includes('rejected')) {
    return 'Transaction was rejected in wallet';
  }
  if (message.includes('password') || message.includes('Password')) {
    return 'Invalid password. Please try again.';
  }
  if (message.includes('already claimed') || message.includes('Already claimed')) {
    return 'You have already claimed your GregoCoin tokens.';
  }

  return message;
}
