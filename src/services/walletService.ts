/**
 * Wallet Service
 * Pure functions for wallet-related operations
 */

import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { ChainInfo } from '@aztec/aztec.js/account';
import { Fr } from '@aztec/aztec.js/fields';
import { createLogger } from '@aztec/foundation/log';
import { AztecSQLiteOPFSStore } from '@aztec/kv-store/sqlite-opfs';
import { registerSqliteInspectors } from '../utils/sqliteInspector';
import {
  WalletManager,
  type WalletProvider,
  type PendingConnection,
  type DiscoverySession,
} from '@aztec/wallet-sdk/manager';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { EmbeddedWallet } from '@gregojuice/embedded-wallet';
import type { NetworkConfig } from '../config/networks';

/**
 * Web wallet URLs to probe during discovery.
 * Set VITE_WEB_WALLET_URL in .env or CI to override the default dev URL.
 */
const WEB_WALLET_URLS: string[] = [import.meta.env.VITE_WEB_WALLET_URL ?? 'http://localhost:3001'];

const APP_ID = 'gregoswap';

/**
 * Creates an Aztec node client for the given node URL
 */
export function createNodeClient(nodeUrl: string): AztecNode {
  return createAztecNodeClient(nodeUrl);
}

/**
 * Creates an embedded wallet and ensures it has an account.
 * Uses initializerless Schnorr accounts — no on-chain deployment needed.
 * The wallet's internal DB persists the account, so the same address is restored on reload.
 */
export async function createEmbeddedWallet(
  node: AztecNode,
): Promise<{ wallet: EmbeddedWallet; address: AztecAddress }> {
  // Both PXE state and the wallet's own DB go on SQLite-OPFS. Each store needs a
  // distinct OPFS pool directory because SAH Pool acquires an exclusive lock on
  // its directory — one shared directory would collide in a single tab. The
  // rollup address scopes the DB names so switching networks doesn't
  // cross-contaminate.
  const l1Contracts = await node.getL1ContractAddresses();
  const rollup = l1Contracts.rollupAddress.toString();
  const pxeStore = await AztecSQLiteOPFSStore.open(
    createLogger('pxe:data:sqlite-opfs'),
    `pxe_data_${rollup}`,
    false,
    `.aztec-kv-pxe-${rollup}`,
  );
  const walletStore = await AztecSQLiteOPFSStore.open(
    createLogger('wallet:data:sqlite-opfs'),
    `wallet_data_${rollup}`,
    false,
    `.aztec-kv-wallet-${rollup}`,
  );
  const wallet = await EmbeddedWallet.create(node, {
    pxe: { proverEnabled: true, store: pxeStore },
    walletDb: { store: walletStore },
  });
  if (import.meta.env.DEV) {
    // Expose dev-only inspectors at `window.__aztecStores`. See sqliteInspector.ts.
    registerSqliteInspectors({ pxe: pxeStore, wallet: walletStore });
  }
  let accountManager = await wallet.loadStoredAccount();
  if (!accountManager) {
    accountManager = await wallet.createInitializerlessAccount();
  }
  return { wallet, address: accountManager.address };
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
 * Starts wallet discovery process (extension + web wallets in parallel).
 * Returns a DiscoverySession that yields providers as they are discovered.
 */
export function discoverWallets(chainInfo: ChainInfo, timeout?: number): DiscoverySession {
  return WalletManager.configure({
    extensions: { enabled: true },
    webWallets: { urls: WEB_WALLET_URLS },
  }).getAvailableWallets({
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

