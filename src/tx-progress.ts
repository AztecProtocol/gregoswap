/**
 * Transaction Progress Tracking
 * Event-based system for reporting tx lifecycle phases from the embedded wallet.
 * The EmbeddedWallet emits events; the TxNotificationCenter listens and renders toast UI.
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

class TxProgressEmitter {
  private listeners = new Set<TxProgressListener>();

  subscribe(listener: TxProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: TxProgressEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** Singleton emitter shared between EmbeddedWallet and UI */
export const txProgress = new TxProgressEmitter();
