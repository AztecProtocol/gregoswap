/**
 * IframeWalletProvider — implements WalletProvider for web wallets loaded in iframes.
 *
 * Flow (mirrors ExtensionProvider from @aztec/wallet-sdk):
 *   1. Creates an <iframe src="walletUrl"> (in app-provided container or floating panel)
 *   2. Waits for WALLET_READY message from the iframe
 *   3. Sends DISCOVERY → waits for DISCOVERY_RESPONSE
 *   4. Sends KEY_EXCHANGE_REQUEST (ECDH public key) → waits for KEY_EXCHANGE_RESPONSE
 *   5. Derives shared session keys, exposes verificationHash
 *   6. On confirm(): returns IframeWallet backed by the established session
 */

import type { ChainInfo } from '@aztec/aztec.js/account';
import type { Wallet } from '@aztec/aztec.js/wallet';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSessionKeys,
} from '@aztec/wallet-sdk/crypto';
import { promiseWithResolvers } from '@aztec/foundation/promise';
import type { PendingConnection, WalletProvider, ProviderDisconnectionCallback } from '@aztec/wallet-sdk/manager';
import { IframeMessageType } from './iframe-message-types.ts';
import { IframeWallet } from './iframe-wallet.ts';

const READY_TIMEOUT_MS = 15_000;
const DISCOVERY_TIMEOUT_MS = 15_000;
const KEY_EXCHANGE_TIMEOUT_MS = 15_000;

export class IframeWalletProvider implements WalletProvider {
  readonly type = 'web' as const;

  private iframe: HTMLIFrameElement | null = null;
  private _container: HTMLDivElement | null = null;
  private _appOwnsContainer = false;
  private _dragCleanup: (() => void) | null = null;
  private wallet: IframeWallet | null = null;
  private _disconnected = false;
  private disconnectCallbacks: ProviderDisconnectionCallback[] = [];

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly icon: string | undefined,
    private readonly walletUrl: string,
    private readonly chainInfo: ChainInfo,
  ) {}

  async establishSecureChannel(appId: string, options?: { container?: HTMLElement }): Promise<PendingConnection> {
    const iframe = document.createElement('iframe');
    iframe.src = this.walletUrl;
    iframe.style.cssText = `
      flex: 1;
      border: none;
      width: 100%;
      height: 100%;
      display: block;
    `;
    iframe.allow = 'storage-access; cross-origin-isolated';
    this.iframe = iframe;

    if (options?.container) {
      // App-provided container: inject iframe directly, no floating panel UI
      this._appOwnsContainer = true;
      options.container.appendChild(iframe);
    } else {
      // Default: create draggable/resizable floating panel
      this.createFloatingPanel(iframe);
    }

    const walletOrigin = new URL(this.walletUrl).origin;

    // Helper: post to iframe with origin check
    const post = (msg: object) => {
      if (!iframe.contentWindow) throw new Error('Iframe not ready');
      iframe.contentWindow.postMessage(msg, walletOrigin);
    };

    // 2. Wait for WALLET_READY
    await waitForMessage(
      (msg) => msg.type === IframeMessageType.WALLET_READY,
      READY_TIMEOUT_MS,
      walletOrigin,
    );

    // 3. Discovery request → response
    const requestId = globalThis.crypto.randomUUID();
    post({ type: IframeMessageType.DISCOVERY, requestId, appId });

    const discoveryResp = await waitForMessage(
      (msg) => msg.type === IframeMessageType.DISCOVERY_RESPONSE && msg.requestId === requestId,
      DISCOVERY_TIMEOUT_MS,
      walletOrigin,
    );

    const walletInfo = discoveryResp.walletInfo as { id: string; name: string; version: string; icon?: string };

    // 4. Key exchange
    const keyPair = await generateKeyPair();
    const dAppPublicKey = await exportPublicKey(keyPair.publicKey);
    post({ type: IframeMessageType.KEY_EXCHANGE_REQUEST, requestId, publicKey: dAppPublicKey });

    const keyExchangeResp = await waitForMessage(
      (msg) => msg.type === IframeMessageType.KEY_EXCHANGE_RESPONSE && msg.requestId === requestId,
      KEY_EXCHANGE_TIMEOUT_MS,
      walletOrigin,
    );

    const walletPublicKey = await importPublicKey(keyExchangeResp.publicKey);
    const sessionKeys = await deriveSessionKeys(keyPair, walletPublicKey, true);

    const { verificationHash, encryptionKey: sharedKey } = sessionKeys;

    // 5. Build the IframeWallet (not yet returned to consumer — waiting for confirm())
    const iframeWallet = IframeWallet.create(
      walletInfo.id,
      requestId, // sessionId
      iframe.contentWindow!,
      walletOrigin,
      sharedKey,
      this.chainInfo,
      appId,
    );

    this.wallet = iframeWallet;

    // Register disconnect handling
    iframeWallet.onDisconnect(() => {
      this._disconnected = true;
      for (const cb of this.disconnectCallbacks) {
        try { cb(); } catch {}
      }
    });

    // 6. Return PendingConnection
    let cancelled = false;

    const pendingConnection: PendingConnection = {
      verificationHash,
      confirm: async (): Promise<Wallet> => {
        if (cancelled) throw new Error('Connection was cancelled');
        return iframeWallet.asWallet();
      },
      cancel: () => {
        cancelled = true;
        this.cleanup();
      },
    };

    return pendingConnection;
  }

  async disconnect(): Promise<void> {
    if (this.wallet && !this.wallet.isDisconnected()) {
      await this.wallet.disconnect();
    }
    this.cleanup();
  }

  onDisconnect(callback: ProviderDisconnectionCallback): () => void {
    this.disconnectCallbacks.push(callback);
    return () => {
      const i = this.disconnectCallbacks.indexOf(callback);
      if (i !== -1) this.disconnectCallbacks.splice(i, 1);
    };
  }

  isDisconnected(): boolean {
    return this._disconnected;
  }

  // ── Floating panel creation ─────────────────────────────────────────────────

  private createFloatingPanel(iframe: HTMLIFrameElement): void {
    const W = 420, H = 500;
    const initLeft = window.innerWidth - W - 24;
    const initTop = window.innerHeight - H - 24;

    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      left: ${initLeft}px;
      top: ${initTop}px;
      width: ${W}px;
      height: ${H}px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      z-index: 999999;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      user-select: none;
    `;

    // Drag handle bar
    const dragHandle = document.createElement('div');
    dragHandle.style.cssText = `
      height: 28px;
      min-height: 28px;
      background: rgba(30,30,30,0.95);
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    `;
    dragHandle.innerHTML = `<span style="color:rgba(255,255,255,0.3);font-size:14px;letter-spacing:4px">&#8942;&#8942;&#8942;</span>`;

    // Resize handle (bottom-right corner)
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = `
      position: absolute;
      bottom: 0;
      right: 0;
      width: 16px;
      height: 16px;
      cursor: se-resize;
      z-index: 1;
    `;
    resizeHandle.innerHTML = `<svg width="16" height="16" style="opacity:0.3;display:block"><path d="M2 14 L14 2 M6 14 L14 6 M10 14 L14 10" stroke="white" stroke-width="1.5"/></svg>`;

    container.appendChild(dragHandle);
    container.appendChild(iframe);
    container.appendChild(resizeHandle);
    document.body.appendChild(container);
    this._container = container;

    // ── Drag logic ──────────────────────────────────────────────────────────
    let dragging = false;
    let dragOffsetX = 0, dragOffsetY = 0;

    dragHandle.addEventListener('mousedown', (e: MouseEvent) => {
      dragging = true;
      dragHandle.style.cursor = 'grabbing';
      const rect = container.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      iframe.style.pointerEvents = 'none';
      e.preventDefault();
    });

    // ── Resize logic ─────────────────────────────────────────────────────────
    let resizing = false;
    let resizeStartX = 0, resizeStartY = 0;
    let resizeStartW = 0, resizeStartH = 0;
    const MIN_W = 280, MIN_H = 320;

    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      resizing = true;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = container.offsetWidth;
      resizeStartH = container.offsetHeight;
      iframe.style.pointerEvents = 'none';
      e.preventDefault();
      e.stopPropagation();
    });

    const onMouseMove = (e: MouseEvent) => {
      if (dragging) {
        const newLeft = Math.max(0, Math.min(window.innerWidth - container.offsetWidth, e.clientX - dragOffsetX));
        const newTop = Math.max(0, Math.min(window.innerHeight - container.offsetHeight, e.clientY - dragOffsetY));
        container.style.left = `${newLeft}px`;
        container.style.top = `${newTop}px`;
      } else if (resizing) {
        const newW = Math.max(MIN_W, resizeStartW + (e.clientX - resizeStartX));
        const newH = Math.max(MIN_H, resizeStartH + (e.clientY - resizeStartY));
        container.style.width = `${newW}px`;
        container.style.height = `${newH}px`;
      }
    };

    const onMouseUp = () => {
      if (dragging) dragHandle.style.cursor = 'grab';
      dragging = false;
      resizing = false;
      iframe.style.pointerEvents = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    this._dragCleanup = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private cleanup(): void {
    this._dragCleanup?.();
    this._dragCleanup = null;

    if (this._appOwnsContainer) {
      // App owns the container — only remove the iframe we injected
      if (this.iframe && this.iframe.parentNode) {
        this.iframe.parentNode.removeChild(this.iframe);
      }
    } else if (this._container && this._container.parentNode) {
      // We created the floating panel — remove the whole thing
      this._container.parentNode.removeChild(this._container);
    }

    this._container = null;
    this.iframe = null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function waitForMessage(
  predicate: (msg: any) => boolean,
  timeoutMs: number,
  expectedOrigin: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error(`Iframe wallet: timed out waiting for message (${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      if (event.origin !== expectedOrigin) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (predicate(msg)) {
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(msg);
      }
    }

    window.addEventListener('message', handler);
  });
}
