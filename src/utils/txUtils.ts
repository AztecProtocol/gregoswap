import type { SentTx } from '@aztec/aztec.js/contracts';
import { TxStatus } from '@aztec/stdlib/tx';

/**
 * Waits for a transaction to be sent to the node and updates the phase callback.
 * This utility polls the transaction receipt to determine if it's been sent to the node
 * (status = PENDING) or if it's been mined (status = SUCCESS or other final states).
 *
 * @param sentTx - The SentTx object returned from calling .send()
 * @param onPhaseChange - Callback to notify phase changes ('sending' | 'mining')
 * @param pollInterval - How often to poll for receipt in milliseconds (default: 500ms)
 * @returns Promise that resolves when the transaction is mined
 */
export async function waitForTxWithPhases(
  sentTx: SentTx,
  onPhaseChange?: (phase: 'sending' | 'mining') => void,
  pollInterval: number = 500,
): Promise<void> {
  // Start in sending phase
  onPhaseChange?.('sending');

  // Poll for receipt until we get one with PENDING status or better
  let hasSwitchedToMining = false;

  const checkReceipt = async (): Promise<boolean> => {
    try {
      const receipt = await sentTx.getReceipt();

      // If we have a receipt with PENDING status, the tx has been sent to the node
      if (receipt.status === TxStatus.PENDING && !hasSwitchedToMining) {
        hasSwitchedToMining = true;
        onPhaseChange?.('mining');
      }

      // If status is final (not PENDING), we're done
      if (receipt.status !== TxStatus.PENDING) {
        return true;
      }

      return false;
    } catch (error) {
      // Receipt not available yet, keep polling
      return false;
    }
  };

  // Poll until transaction is mined
  while (!(await checkReceipt())) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Finally, call wait() to get the full receipt and handle any errors
  await sentTx.wait();
}
