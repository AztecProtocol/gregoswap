/**
 * IframeWallet — Wallet that communicates with a web wallet loaded in a hidden iframe.
 *
 * This mirrors ExtensionWallet from @aztec/wallet-sdk but uses
 * window.postMessage / window.addEventListener('message') instead of MessagePort.
 *
 * The wire protocol (encrypted WalletMessage / WalletResponse) is identical.
 */

import type { ChainInfo } from '@aztec/aztec.js/account';
import { type Wallet, WalletSchema } from '@aztec/aztec.js/wallet';
import { jsonStringify } from '@aztec/foundation/json-rpc';
import { type PromiseWithResolvers, promiseWithResolvers } from '@aztec/foundation/promise';
import { schemaHasMethod } from '@aztec/foundation/schemas';
import type { FunctionsOf } from '@aztec/foundation/types';
import {
  decrypt,
  encrypt,
  type EncryptedPayload,
} from '@aztec/wallet-sdk/crypto';
import type { WalletMessage, WalletResponse } from '@aztec/wallet-sdk/types';
import { IframeMessageType } from './iframe-message-types.ts';

type WalletMethodCall = {
  type: keyof FunctionsOf<Wallet>;
  args: unknown[];
};

export type DisconnectCallback = () => void;

export class IframeWallet {
  private inFlight = new Map<string, PromiseWithResolvers<unknown>>();
  private disconnected = false;
  private disconnectCallbacks: DisconnectCallback[] = [];
  private messageListener: ((e: MessageEvent) => void) | null = null;

  private constructor(
    private chainInfo: ChainInfo,
    private appId: string,
    private walletId: string,
    private sessionId: string,
    private iframeWindow: Window,
    private walletOrigin: string,
    private sharedKey: CryptoKey,
  ) {}

  static create(
    walletId: string,
    sessionId: string,
    iframeWindow: Window,
    walletOrigin: string,
    sharedKey: CryptoKey,
    chainInfo: ChainInfo,
    appId: string,
  ): IframeWallet {
    const wallet = new IframeWallet(chainInfo, appId, walletId, sessionId, iframeWindow, walletOrigin, sharedKey);

    // Listen for SECURE_RESPONSE from the wallet iframe
    wallet.messageListener = (event: MessageEvent) => {
      if (event.origin !== walletOrigin) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === IframeMessageType.SECURE_RESPONSE && msg.sessionId === sessionId) {
        void wallet.handleEncryptedResponse(msg.encrypted as EncryptedPayload);
      } else if (msg.type === IframeMessageType.SESSION_DISCONNECTED && msg.sessionId === sessionId) {
        wallet.handleDisconnect();
      }
    };
    window.addEventListener('message', wallet.messageListener);

    return new Proxy(wallet, {
      get: (target, prop, receiver) => {
        if (prop === 'asWallet') {
          return () => receiver as unknown as Wallet;
        } else if (schemaHasMethod(WalletSchema, prop.toString())) {
          return async (...args: unknown[]) => {
            const result = await target.postMessage({
              type: prop.toString() as keyof FunctionsOf<Wallet>,
              args,
            });
            return WalletSchema[prop.toString() as keyof typeof WalletSchema].returnType().parseAsync(result);
          };
        } else {
          return target[prop as keyof IframeWallet];
        }
      },
    });
  }

  asWallet(): Wallet {
    return this as unknown as Wallet;
  }

  private async handleEncryptedResponse(encrypted: EncryptedPayload): Promise<void> {
    try {
      const response = await decrypt<WalletResponse>(this.sharedKey, encrypted);
      const { messageId, result, error, walletId: responseWalletId } = response;

      if (!messageId || responseWalletId !== this.walletId) return;

      const pending = this.inFlight.get(messageId);
      if (!pending) return;

      if (error) {
        pending.reject(new Error(jsonStringify(error)));
      } else {
        pending.resolve(result);
      }
      this.inFlight.delete(messageId);
    } catch {
      // Decryption errors are silently ignored
    }
  }

  private async postMessage(call: WalletMethodCall): Promise<unknown> {
    if (this.disconnected) throw new Error('Wallet has been disconnected');

    const messageId = globalThis.crypto.randomUUID();
    const message: WalletMessage = {
      type: call.type,
      args: call.args,
      messageId,
      chainInfo: this.chainInfo,
      appId: this.appId,
      walletId: this.walletId,
    };

    const encrypted = await encrypt(this.sharedKey, jsonStringify(message));
    this.iframeWindow.postMessage(
      { type: IframeMessageType.SECURE_MESSAGE, sessionId: this.sessionId, encrypted },
      this.walletOrigin,
    );

    const { promise, resolve, reject } = promiseWithResolvers<unknown>();
    this.inFlight.set(messageId, { promise, resolve, reject });
    return promise;
  }

  private handleDisconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;

    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }

    const error = new Error('Wallet disconnected');
    for (const { reject } of this.inFlight.values()) reject(error);
    this.inFlight.clear();

    for (const cb of this.disconnectCallbacks) {
      try { cb(); } catch {}
    }
  }

  onDisconnect(callback: DisconnectCallback): () => void {
    this.disconnectCallbacks.push(callback);
    return () => {
      const i = this.disconnectCallbacks.indexOf(callback);
      if (i !== -1) this.disconnectCallbacks.splice(i, 1);
    };
  }

  isDisconnected(): boolean {
    return this.disconnected;
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.iframeWindow.postMessage(
      { type: IframeMessageType.DISCONNECT, sessionId: this.sessionId },
      this.walletOrigin,
    );
    this.handleDisconnect();
  }
}
