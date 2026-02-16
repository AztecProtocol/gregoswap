/**
 * Transaction Progress Tracking
 * Event-based system for reporting tx lifecycle phases from the embedded wallet.
 * The EmbeddedWallet emits events; the TxNotificationCenter listens and renders toast UI.
 * Completed/errored events are persisted to localStorage, scoped by account address.
 */

export type TxPhase = 'simulating' | 'proving' | 'sending' | 'mining' | 'complete' | 'error';

export interface PhaseTiming {
  name: string;
  duration: number;
  color: string;
  breakdown?: Array<{ label: string; duration: number }>;
}

export interface TxProgressEvent {
  txId: string;
  label: string;
  phase: TxPhase;
  /** Wall-clock start time (Date.now()) of this tx */
  startTime: number;
  /** Per-phase wall-clock durations collected so far */
  phaseTimings: {
    simulation?: number;
    proving?: number;
    sending?: number;
    mining?: number;
  };
  /** Detailed phase breakdown for the timeline bar */
  phases: PhaseTiming[];
  /** Error message if phase === 'error' */
  error?: string;
}

type TxProgressListener = (event: TxProgressEvent) => void;

const STORAGE_PREFIX = 'gregoswap_tx_history_';
const MAX_STORED = 50;

class TxProgressEmitter {
  private listeners = new Set<TxProgressListener>();
  private accountKey: string | null = null;

  subscribe(listener: TxProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: TxProgressEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
    // Persist terminal events
    if (event.phase === 'complete' || event.phase === 'error') {
      this.persist(event);
    }
  }

  /** Set the active account to scope persistent storage. Loads existing history. */
  setAccount(address: string) {
    this.accountKey = `${STORAGE_PREFIX}${address}`;
  }

  /** Load persisted history for the current account. */
  loadHistory(): TxProgressEvent[] {
    if (!this.accountKey) return [];
    try {
      const raw = localStorage.getItem(this.accountKey);
      if (!raw) return [];
      return JSON.parse(raw) as TxProgressEvent[];
    } catch {
      return [];
    }
  }

  /** Remove a tx from persisted storage. */
  dismissPersisted(txId: string) {
    if (!this.accountKey) return;
    try {
      const history = this.loadHistory().filter(e => e.txId !== txId);
      localStorage.setItem(this.accountKey, JSON.stringify(history));
    } catch {
      // localStorage unavailable
    }
  }

  private persist(event: TxProgressEvent) {
    if (!this.accountKey) return;
    try {
      const history = this.loadHistory();
      const idx = history.findIndex(e => e.txId === event.txId);
      if (idx >= 0) {
        history[idx] = event;
      } else {
        history.push(event);
      }
      // Keep only the most recent entries
      const trimmed = history.slice(-MAX_STORED);
      localStorage.setItem(this.accountKey, JSON.stringify(trimmed));
    } catch {
      // localStorage unavailable
    }
  }
}

/** Singleton emitter shared between EmbeddedWallet and UI */
export const txProgress = new TxProgressEmitter();
