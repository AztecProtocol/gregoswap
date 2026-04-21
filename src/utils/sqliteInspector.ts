/**
 * Dev-only inspectors for SQLite-OPFS stores.
 *
 * Exposed on `window.__aztecStores` by walletService.ts in development mode so the
 * DB contents can be examined from the browser DevTools console without
 * copy-pasting recipes. These helpers are a no-op in production builds.
 */

import type { AztecAsyncKVStore } from '@aztec/kv-store';

/** Minimal subset of AztecSQLiteOPFSStore the inspectors need. */
interface InspectableStore extends AztecAsyncKVStore {
  allAsync(sql: string, bind?: unknown[]): Promise<unknown[][]>;
  exportDb(): Promise<Uint8Array>;
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    // Revoke after the click handler has started the download, give the browser a beat.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/**
 * Summary row: container name and row count. Useful for a quick overview of what
 * each store holds right now.
 */
async function summarize(store: InspectableStore): Promise<Array<{ container: string; rows: number }>> {
  const rows = await store.allAsync(
    'SELECT container, count(*) AS n FROM data GROUP BY container ORDER BY n DESC',
  );
  return rows.map(r => ({ container: String(r[0]), rows: Number(r[1]) }));
}

/** AES-GCM ciphertexts written by AesGcmCipher start with 0x01 (the version byte).
 *  HMAC-SHA-256 always produces 32 bytes, so HMAC'd key columns show that width. */
const AES_GCM_VERSION_BYTE = 0x01;
const HMAC_SHA256_BYTES = 32;

/**
 * Samples one row per container and reports whether the value looks encrypted and
 * the key looks HMAC'd. A quick visual confirmation that the cipher is wired up
 * correctly — a plaintext store shows `valueEncrypted: false` across the board.
 *
 * Done as "list containers, then fetch one row each" because the `data` table is
 * `WITHOUT ROWID` (slot is the PK), so `rowid` doesn't exist.
 */
async function peek(store: InspectableStore): Promise<
  Array<{ container: string; valueEncrypted: boolean; keyLooksHmacd: boolean; sampleKeyBytes: number; sampleValueBytes: number; rows: number }>
> {
  const containers = await store.allAsync(
    'SELECT container, count(*) AS n FROM data GROUP BY container ORDER BY container',
  );
  const out: Array<{
    container: string;
    valueEncrypted: boolean;
    keyLooksHmacd: boolean;
    sampleKeyBytes: number;
    sampleValueBytes: number;
    rows: number;
  }> = [];
  for (const row of containers) {
    const container = String(row[0]);
    const rowCount = Number(row[1]);
    const sample = await store.allAsync('SELECT key, value FROM data WHERE container = ? LIMIT 1', [container]);
    const key = sample[0]?.[0] as Uint8Array | null;
    const value = sample[0]?.[1] as Uint8Array | null;
    out.push({
      container,
      valueEncrypted: value instanceof Uint8Array && value.length > 0 && value[0] === AES_GCM_VERSION_BYTE,
      keyLooksHmacd: key instanceof Uint8Array && key.length === HMAC_SHA256_BYTES,
      sampleKeyBytes: key instanceof Uint8Array ? key.length : 0,
      sampleValueBytes: value instanceof Uint8Array ? value.length : 0,
      rows: rowCount,
    });
  }
  return out;
}

/** Stores exposed for inspection, plus their bound helpers. */
export type SqliteInspectors = {
  pxe: InspectableStore;
  wallet: InspectableStore;
  /** Downloads the PXE store as `pxe.sqlite`. */
  downloadPxe(): Promise<void>;
  /** Downloads the walletDB store as `wallet.sqlite`. */
  downloadWallet(): Promise<void>;
  /** Prints container/row-count summaries for both stores (console-friendly). */
  summary(): Promise<{ pxe: Array<{ container: string; rows: number }>; wallet: Array<{ container: string; rows: number }> }>;
  /** Samples one row per container in each store and reports whether values are
   *  encrypted (AES-GCM version byte) and whether keys look HMAC'd (32 bytes). */
  peekEncryption(): Promise<{ pxe: Awaited<ReturnType<typeof peek>>; wallet: Awaited<ReturnType<typeof peek>> }>;
};

/**
 * Registers the inspectors on `window.__aztecStores`. Safe to call in SSR/non-dev
 * contexts — it bails out cleanly.
 */
export function registerSqliteInspectors(stores: { pxe: InspectableStore; wallet: InspectableStore }): void {
  if (typeof window === 'undefined') {
    return;
  }
  const inspectors: SqliteInspectors = {
    pxe: stores.pxe,
    wallet: stores.wallet,
    downloadPxe: async () => downloadBytes(await stores.pxe.exportDb(), 'pxe.sqlite'),
    downloadWallet: async () => downloadBytes(await stores.wallet.exportDb(), 'wallet.sqlite'),
    summary: async () => ({
      pxe: await summarize(stores.pxe),
      wallet: await summarize(stores.wallet),
    }),
    peekEncryption: async () => ({
      pxe: await peek(stores.pxe),
      wallet: await peek(stores.wallet),
    }),
  };
  (window as unknown as { __aztecStores: SqliteInspectors }).__aztecStores = inspectors;
}
