/**
 * Profiling orchestrator.
 *
 * Instruments the embedded wallet, PXE, node client, fetch, and WASM from
 * the outside — no wallet code changes needed.
 *
 * Usage:
 *   await profiler.install();               // global interceptors (fetch, WASM)
 *   profiler.instrumentWallet(wallet);       // wrap wallet + its PXE + node
 *   profiler.start('sendTx');
 *   // ... perform operation ...
 *   const report = profiler.stop();
 */

import { installFetchInterceptor, installWasmInterceptor, installSimulatorInterceptorFromPXE } from './interceptors';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Category = 'wallet' | 'pxe' | 'sim' | 'oracle' | 'node' | 'rpc' | 'wasm';

export interface ProfileRecord {
  name: string;
  category: Category;
  start: number;    // ms from recording origin
  duration: number; // ms
  detail?: string;
  error?: boolean;
}

export interface ProfileReport {
  name: string;
  startedAt: number;    // Date.now() at recording start
  durationMs: number;
  records: ProfileRecord[];
}

// ─── Method wrapping ─────────────────────────────────────────────────────────

// Methods to skip — internal noise, getters, or things that break if wrapped.
const SKIP = new Set([
  'constructor', 'toString', 'toJSON', 'valueOf',
  'then',       // wrapping 'then' would break Promise detection
  'log',        // logger getter
]);

/**
 * Collect all method names from an object and its prototype chain,
 * stopping at Object.prototype.
 */
function collectMethods(target: any): string[] {
  const seen = new Set<string>();
  let obj = target;
  while (obj && obj !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(obj)) {
      if (SKIP.has(name) || name.startsWith('_')) continue;
      try {
        if (typeof obj[name] === 'function' && !seen.has(name)) {
          seen.add(name);
        }
      } catch {
        // getter that throws — skip
      }
    }
    obj = Object.getPrototypeOf(obj);
  }
  return [...seen];
}

function wrapAllMethods(
  target: any,
  category: Category,
  profiler: Profiler,
): () => void {
  const restores: (() => void)[] = [];
  const methods = collectMethods(target);

  for (const name of methods) {
    const original = target[name];
    if (typeof original !== 'function' || (original as any).__profiled) continue;

    const wrapped = function (this: any, ...args: any[]) {
      if (!profiler.isRecording) return original.apply(this, args);
      const t0 = performance.now();
      let result: any;
      try {
        result = original.apply(this, args);
      } catch (e) {
        profiler.record(name, category, t0, performance.now() - t0, undefined, true);
        throw e;
      }
      if (result && typeof result.then === 'function') {
        return result.then(
          (v: any) => {
            profiler.record(name, category, t0, performance.now() - t0);
            return v;
          },
          (e: any) => {
            profiler.record(name, category, t0, performance.now() - t0, undefined, true);
            throw e;
          },
        );
      }
      profiler.record(name, category, t0, performance.now() - t0);
      return result;
    };
    (wrapped as any).__profiled = true;
    target[name] = wrapped;
    restores.push(() => { target[name] = original; });
  }

  return () => restores.forEach(r => r());
}

// ─── Profiler ────────────────────────────────────────────────────────────────

class Profiler {
  private _recording = false;
  private _origin = 0;
  private _startedAt = 0;
  private _name = '';
  private _records: ProfileRecord[] = [];
  private _cleanups: (() => void)[] = [];
  private _installed = false;

  get isRecording() { return this._recording; }
  get isInstalled() { return this._installed; }

  /** Push a completed record. Called by interceptors and method wrappers. */
  record(
    name: string,
    category: Category,
    startAbsolute: number,
    duration: number,
    detail?: string,
    error?: boolean,
  ) {
    if (!this._recording) return;
    this._records.push({
      name,
      category,
      start: startAbsolute - this._origin,
      duration,
      detail,
      error,
    });
  }

  /** Install global interceptors (fetch, bb.js WASM). Call once, before wallet creation ideally. */
  async install() {
    if (this._installed) return;
    const recFn = this.record.bind(this);
    const isRec = () => this._recording;
    this._cleanups.push(installFetchInterceptor(recFn, isRec));
    this._cleanups.push(await installWasmInterceptor(recFn, isRec));
    this._installed = true;
  }

  /** Wrap a wallet instance + its internal PXE + node. Call once per wallet. */
  instrumentWallet(wallet: any) {
    this._cleanups.push(wrapAllMethods(wallet, 'wallet', this));

    const pxe = wallet.pxe;
    if (pxe) {
      this._cleanups.push(wrapAllMethods(pxe, 'pxe', this));
      // Patch circuit simulator prototypes (ACVM witness generation)
      const recFn = this.record.bind(this);
      const isRec = () => this._recording;
      this._cleanups.push(installSimulatorInterceptorFromPXE(pxe, recFn, isRec));
    }

    const node = wallet.aztecNode;
    if (node) {
      this._cleanups.push(wrapAllMethods(node, 'node', this));
    }
  }

  start(name = 'profile') {
    if (this._recording) return;
    this._name = name;
    this._origin = performance.now();
    this._startedAt = Date.now();
    this._records = [];
    this._recording = true;
    console.info(`[profiler] Started: "${name}"`);
  }

  stop(): ProfileReport {
    if (!this._recording) {
      return { name: '', startedAt: 0, durationMs: 0, records: [] };
    }
    this._recording = false;
    const durationMs = performance.now() - this._origin;
    const records = this.deduplicateBatchedCalls([...this._records]);
    const report: ProfileReport = {
      name: this._name,
      startedAt: this._startedAt,
      durationMs,
      records,
    };
    console.info(
      `[profiler] Stopped: "${this._name}" — ${(durationMs / 1000).toFixed(2)}s, ` +
      `${report.records.length} spans`,
    );
    return report;
  }

  /**
   * When the node client batches multiple calls into one fetch, we capture
   * both the individual node method spans AND the batch rpc span — same
   * timing, redundant visual noise. Remove the individual node/rpc records
   * that are covered by a batch.
   */
  private deduplicateBatchedCalls(records: ProfileRecord[]): ProfileRecord[] {
    const batches = records.filter(
      r => r.category === 'rpc' && r.name.startsWith('[batch]'),
    );
    if (batches.length === 0) return records;

    return records.filter(r => {
      // Only deduplicate node-level and individual rpc records
      if (r.category !== 'node' && r.category !== 'rpc') return true;
      // Keep batch records themselves
      if (r.name.startsWith('[batch]')) return true;

      const rEnd = r.start + r.duration;

      for (const batch of batches) {
        const batchEnd = batch.start + batch.duration;
        // Check timing overlap (the node call and batch should overlap)
        if (batch.start > rEnd || batchEnd < r.start) continue;
        // Check if the batch label mentions this method name
        if (batch.name.includes(r.name)) return false;
      }
      return true;
    });
  }

  download(report: ProfileReport) {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profile-${report.name}-${new Date(report.startedAt).toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  uninstall() {
    this._cleanups.forEach(c => c());
    this._cleanups = [];
    this._installed = false;
  }
}

export const profiler = new Profiler();
