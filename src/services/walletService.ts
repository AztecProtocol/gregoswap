/**
 * Wallet Service
 * Pure functions for wallet-related operations
 */

import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { ChainInfo } from '@aztec/aztec.js/account';
import { Fr } from '@aztec/aztec.js/fields';
import {
  WalletManager,
  type WalletProvider,
  type PendingConnection,
  type DiscoverySession,
} from '@aztec/wallet-sdk/manager';
import { EmbeddedWallet } from '../embedded_wallet';
import type { NetworkConfig } from '../config/networks';

const APP_ID = 'gregoswap';

/**
 * Creates an Aztec node client for the given node URL
 */
export function createNodeClient(nodeUrl: string): AztecNode {
  return createAztecNodeClient(nodeUrl);
}

/**
 * Creates an embedded wallet for use without an external wallet
 */
export async function createEmbeddedWallet(node: AztecNode): Promise<EmbeddedWallet> {
  return EmbeddedWallet.create(node);
}

/**
 * Gets the chain info from a network configuration
 */
export function getChainInfo(network: NetworkConfig): ChainInfo {
  return {
    chainId: Fr.fromString(network.chainId),
    version: Fr.fromString(network.rollupVersion),
  };
}

/**
 * Starts wallet discovery process
 * Returns a DiscoverySession that yields wallets as they are discovered
 */
export function discoverWallets(chainInfo: ChainInfo, timeout?: number): DiscoverySession {
  const manager = WalletManager.configure({ extensions: { enabled: true } });
  return manager.getAvailableWallets({
    chainInfo,
    appId: APP_ID,
    timeout,
  });
}

/**
 * Initiates a secure connection with a wallet provider
 * Returns a PendingConnection for emoji verification
 */
export async function initiateConnection(provider: WalletProvider): Promise<PendingConnection> {
  return provider.establishSecureChannel(APP_ID);
}

/**
 * Confirms a pending connection after emoji verification
 * Returns the connected wallet
 */
export async function confirmConnection(pendingConnection: PendingConnection): Promise<Wallet> {
  return pendingConnection.confirm();
}

/**
 * Cancels a pending connection
 */
export function cancelConnection(pendingConnection: PendingConnection): void {
  pendingConnection.cancel();
}

/**
 * Disconnects from a wallet provider
 */
export async function disconnectProvider(provider: WalletProvider): Promise<void> {
  if (provider.disconnect) {
    await provider.disconnect();
  }
}
