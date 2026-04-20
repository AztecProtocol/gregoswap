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
  };
  (window as unknown as { __aztecStores: SqliteInspectors }).__aztecStores = inspectors;
}
