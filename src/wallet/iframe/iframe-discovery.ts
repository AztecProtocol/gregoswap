/**
 * Web wallet discovery — creates IframeWalletProvider instances from a list of URLs.
 *
 * For each configured URL we probe the wallet by loading a tiny invisible iframe,
 * waiting for WALLET_READY, then sending a DISCOVERY.  On a successful
 * DISCOVERY_RESPONSE we emit an IframeWalletProvider to the caller.
 *
 * This is intentionally lightweight (no key exchange yet) — key exchange happens
 * later when the user selects the wallet and calls `provider.establishSecureChannel()`.
 */

import type { ChainInfo } from '@aztec/aztec.js/account';
import type { DiscoverySession, WalletProvider } from '@aztec/wallet-sdk/manager';
import { promiseWithResolvers } from '@aztec/foundation/promise';
import { IframeMessageType } from './iframe-message-types.ts';
import { IframeWalletProvider } from './iframe-provider.ts';

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Probes a list of web wallet URLs and returns a DiscoverySession compatible
 * with WalletManager's getAvailableWallets() interface.
 *
 * Discovered IframeWalletProvider instances are yielded asynchronously as each
 * wallet responds to the probe.
 */
export function discoverWebWallets(
  walletUrls: string[],
  chainInfo: ChainInfo,
): DiscoverySession {
  const { promise: donePromise, resolve: resolveDone } = promiseWithResolvers<void>();

  let cancelled = false;
  const pendingProviders: WalletProvider[] = [];
  let pendingResolve: ((result: IteratorResult<WalletProvider>) => void) | null = null;
  let completed = false;

  function emit(provider: WalletProvider) {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve({ value: provider, done: false });
    } else {
      pendingProviders.push(provider);
    }
  }

  function markComplete() {
    completed = true;
    resolveDone();
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve({ value: undefined as any, done: true });
    }
  }

  // Probe all URLs in parallel
  const probes = walletUrls.map((url) => probeWallet(url, chainInfo, PROBE_TIMEOUT_MS).then(
    (provider) => { if (!cancelled && provider) emit(provider); },
    () => {}, // ignore probe errors
  ));

  Promise.all(probes).then(() => {
    if (!cancelled) markComplete();
  });

  const wallets: AsyncIterable<WalletProvider> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<WalletProvider>> {
          if (completed && pendingProviders.length === 0) {
            return { value: undefined as any, done: true };
          }
          if (pendingProviders.length > 0) {
            return { value: pendingProviders.shift()!, done: false };
          }
          return new Promise((resolve) => {
            pendingResolve = resolve;
          });
        },
        async return() {
          markComplete();
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
      markComplete();
    },
  };
}

/**
 * Probes a single web wallet URL.
 * Creates a temporary hidden iframe, waits for WALLET_READY, sends DISCOVERY_REQUEST.
 * Returns an IframeWalletProvider on success, null on timeout/failure.
 */
async function probeWallet(
  walletUrl: string,
  chainInfo: ChainInfo,
  timeoutMs: number,
): Promise<IframeWalletProvider | null> {
  const walletOrigin = new URL(walletUrl).origin;
  const iframe = document.createElement('iframe');
  iframe.src = walletUrl;
  iframe.style.display = 'none';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  iframe.style.position = 'absolute';
  iframe.style.top = '-9999px';
  iframe.allow = 'storage-access';
  document.body.appendChild(iframe);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      window.removeEventListener('message', handler);
      clearTimeout(timer);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    let step: 'waiting-ready' | 'waiting-discovery' = 'waiting-ready';
    const requestId = globalThis.crypto.randomUUID();

    function handler(event: MessageEvent) {
      if (event.origin !== walletOrigin) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (step === 'waiting-ready' && msg.type === IframeMessageType.WALLET_READY) {
        step = 'waiting-discovery';
        iframe.contentWindow?.postMessage(
          { type: IframeMessageType.DISCOVERY, requestId, appId: 'gregoswap-discovery' },
          walletOrigin,
        );
      } else if (
        step === 'waiting-discovery' &&
        msg.type === IframeMessageType.DISCOVERY_RESPONSE &&
        msg.requestId === requestId
      ) {
        const info = msg.walletInfo as { id: string; name: string; version: string; icon?: string };
        cleanup();
        resolve(
          new IframeWalletProvider(info.id, info.name, info.icon, walletUrl, chainInfo),
        );
      }
    }

    window.addEventListener('message', handler);
  });
}
