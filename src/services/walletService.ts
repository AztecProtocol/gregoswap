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
import { promiseWithResolvers } from '@aztec/foundation/promise';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { EmbeddedWallet } from '../embedded_wallet';
import type { NetworkConfig } from '../config/networks';
import { discoverWebWallets } from '../wallet/iframe/iframe-discovery.ts';

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
 * Uses the wallet's internal DB for persistence — same address is restored on reload.
 * Returns the wallet and the account address.
 */
export async function createEmbeddedWallet(
  node: AztecNode,
): Promise<{ wallet: EmbeddedWallet; address: AztecAddress }> {
  const wallet = await EmbeddedWallet.create(node, { pxeConfig: { proverEnabled: true } });
  const accountManager = await wallet.getOrCreateAccount();
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
  // Extension wallets
  const extensionSession = WalletManager.configure({ extensions: { enabled: true } }).getAvailableWallets({
    chainInfo,
    appId: APP_ID,
    timeout,
  });

  // Web wallets (probed via hidden iframe)
  const webSession = discoverWebWallets(WEB_WALLET_URLS, chainInfo);

  // Merge both sessions into one DiscoverySession
  return mergeDiscoverySessions([extensionSession, webSession]);
}

/**
 * Merges multiple DiscoverySessions into one.
 * Providers from all sessions are emitted as they arrive.
 * The merged session completes when all sub-sessions complete.
 */
function mergeDiscoverySessions(sessions: DiscoverySession[]): DiscoverySession {
  const { promise: donePromise, resolve: resolveDone } = promiseWithResolvers<void>();

  let cancelled = false;
  const pending: WalletProvider[] = [];
  let pendingResolve: ((result: IteratorResult<WalletProvider>) => void) | null = null;
  let remaining = sessions.length;

  function emit(provider: WalletProvider) {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve({ value: provider, done: false });
    } else {
      pending.push(provider);
    }
  }

  function markOneDone() {
    remaining--;
    if (remaining === 0) {
      resolveDone();
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve({ value: undefined as any, done: true });
      }
    }
  }

  // Drain each session in background
  for (const session of sessions) {
    (async () => {
      try {
        for await (const provider of session.wallets) {
          if (cancelled) break;
          emit(provider);
        }
      } catch {
        // ignore
      } finally {
        markOneDone();
      }
    })();
  }

  const wallets: AsyncIterable<WalletProvider> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<WalletProvider>> {
          if (remaining === 0 && pending.length === 0) {
            return { value: undefined as any, done: true };
          }
          if (pending.length > 0) {
            return { value: pending.shift()!, done: false };
          }
          return new Promise(resolve => {
            pendingResolve = resolve;
          });
        },
        async return() {
          resolveDone();
          return { value: undefined as any, done: true };
        },
      };
    },
  };

  return {
    wallets,
    done: donePromise,
    cancel: () => {
      cancelled = true;
      sessions.forEach(s => s.cancel());
      resolveDone();
    },
  };
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

/**
 * Deploys the embedded wallet's account on-chain. Skips if already deployed.
 */
export async function deployEmbeddedAccount(wallet: EmbeddedWallet): Promise<void> {
  if (await wallet.isAccountDeployed()) {
    return;
  }
  await wallet.deployAccount();
}
