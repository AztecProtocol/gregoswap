/**
 * Fetch + WASM interception for profiling.
 *
 * Fetch: patches window.fetch to extract JSON-RPC method names and record timing.
 * WASM:  patches BarretenbergSync/Barretenberg backend.call to decode msgpack
 *        operation names and record timing for every bb.js API call.
 */

// ─── Callback interface ─────────────────────────────────────────────────────

export type RecordFn = (
  name: string,
  category: 'rpc' | 'wasm' | 'sim' | 'oracle',
  startAbsolute: number,
  duration: number,
  detail?: string,
  error?: boolean,
) => void;

export type IsRecording = () => boolean;

// ─── Fetch interceptor ──────────────────────────────────────────────────────

export function installFetchInterceptor(
  record: RecordFn,
  isRecording: IsRecording,
): () => void {
  const original = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const recording = isRecording();
    if (!recording) return original(input, init);

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const t0 = performance.now();

    // Extract JSON-RPC method name(s) from request body
    let method = '';
    let batched = false;
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body);
        if (Array.isArray(parsed)) {
          batched = true;
          method = parsed.map((r: any) => r?.method ?? '?').join(', ');
        } else if (parsed?.method) {
          method = parsed.method;
        }
      } catch {
        /* not JSON */
      }
    }
    if (!method) {
      try {
        method = new URL(url, location.href).pathname;
      } catch {
        method = url;
      }
    }

    const label = batched ? `[batch] ${method}` : method;

    try {
      const response = await original(input, init);
      record(label, 'rpc', t0, performance.now() - t0, `${response.status}`);
      return response;
    } catch (e) {
      record(label, 'rpc', t0, performance.now() - t0, 'network error', true);
      throw e;
    }
  };

  return () => {
    window.fetch = original;
  };
}

// ─── Msgpack operation name decoder ─────────────────────────────────────────
// bb.js backend.call receives msgpack-encoded [["OperationName", ...args]].
// We extract just the operation name from the first few bytes.

function decodeMsgpackOpName(buf: Uint8Array): string | null {
  try {
    let pos = 0;
    const u8 = (o: number) => buf[o];

    // Outer fixarray header (0x90..0x9f)
    const outer = u8(pos++);
    if ((outer & 0xf0) !== 0x90) return null;
    // Inner fixarray header
    const inner = u8(pos++);
    if ((inner & 0xf0) !== 0x90) return null;
    // String header
    const strHdr = u8(pos++);
    let strLen: number;
    if ((strHdr & 0xe0) === 0xa0) {
      strLen = strHdr & 0x1f; // fixstr
    } else if (strHdr === 0xd9) {
      strLen = u8(pos++); // str 8
    } else {
      return null;
    }
    let name = '';
    for (let i = 0; i < strLen && pos < buf.length; i++) {
      name += String.fromCharCode(u8(pos++));
    }
    return name || null;
  } catch {
    return null;
  }
}

// ─── WASM interceptor ───────────────────────────────────────────────────────

function wrapBackendCall(
  backend: any,
  record: RecordFn,
  isRecording: IsRecording,
  isSync: boolean,
): () => void {
  if (!backend || typeof backend.call !== 'function' || backend.call.__profiled)
    return () => {};

  const original = backend.call.bind(backend);

  if (isSync) {
    backend.call = function (inputBuffer: Uint8Array) {
      if (!isRecording()) return original(inputBuffer);
      const opName = decodeMsgpackOpName(inputBuffer) ?? 'bb_sync';
      const t0 = performance.now();
      const result = original(inputBuffer);
      record(opName, 'wasm', t0, performance.now() - t0);
      return result;
    };
  } else {
    backend.call = async function (inputBuffer: Uint8Array) {
      if (!isRecording()) return original(inputBuffer);
      const opName = decodeMsgpackOpName(inputBuffer) ?? 'bb_async';
      const t0 = performance.now();
      try {
        const result = await original(inputBuffer);
        record(opName, 'wasm', t0, performance.now() - t0);
        return result;
      } catch (err) {
        record(opName, 'wasm', t0, performance.now() - t0, undefined, true);
        throw err;
      }
    };
  }

  backend.call.__profiled = true;
  const restore = () => {
    backend.call = original;
  };
  return restore;
}

export async function installWasmInterceptor(
  record: RecordFn,
  isRecording: IsRecording,
): Promise<() => void> {
  const restores: (() => void)[] = [];

  try {
    const bbMod = await import('@aztec/bb.js');
    const BB = (bbMod as any).Barretenberg;
    const BBSync = (bbMod as any).BarretenbergSync;

    // Patch BarretenbergSync (main-thread hashing: poseidon, pedersen, etc.)
    if (BBSync) {
      // Wrap existing singleton if already initialized
      try {
        const existing = BBSync.getSingleton();
        if (existing?.backend)
          restores.push(
            wrapBackendCall(existing.backend, record, isRecording, true),
          );
      } catch {
        /* not yet init'd */
      }

      // Wrap future singletons
      if (BBSync.initSingleton && !BBSync.initSingleton.__profiled) {
        const orig = BBSync.initSingleton.bind(BBSync);
        BBSync.initSingleton = async (...args: any[]) => {
          const inst = await orig(...args);
          if (inst?.backend)
            restores.push(
              wrapBackendCall(inst.backend, record, isRecording, true),
            );
          return inst;
        };
        BBSync.initSingleton.__profiled = true;
        restores.push(() => {
          BBSync.initSingleton = orig;
        });
      }
    }

    // Patch Barretenberg (async — proving worker, less important but still useful)
    if (BB) {
      try {
        const existing = BB.getSingleton();
        if (existing?.backend)
          restores.push(
            wrapBackendCall(existing.backend, record, isRecording, false),
          );
      } catch {
        /* not yet init'd */
      }

      if (BB.initSingleton && !BB.initSingleton.__profiled) {
        const orig = BB.initSingleton.bind(BB);
        BB.initSingleton = async (...args: any[]) => {
          const inst = await orig(...args);
          if (inst?.backend)
            restores.push(
              wrapBackendCall(inst.backend, record, isRecording, false),
            );
          return inst;
        };
        BB.initSingleton.__profiled = true;
        restores.push(() => {
          BB.initSingleton = orig;
        });
      }
    }
  } catch {
    // @aztec/bb.js not available — no WASM profiling
  }

  return () => restores.forEach((r) => r());
}

// ─── Simulator interceptor ──────────────────────────────────────────────────
// Patches prototype methods on the circuit simulator (ACVM witness generation)
// reached through the PXE instance — no problematic imports needed.

function wrapProtoMethod(
  proto: any,
  method: string,
  record: RecordFn,
  isRecording: IsRecording,
  label: (args: any[]) => string,
): () => void {
  const original = proto[method];
  if (typeof original !== 'function' || original.__profiled) return () => {};

  proto[method] = function (this: any, ...args: any[]) {
    if (!isRecording()) return original.apply(this, args);
    const name = label(args);
    const t0 = performance.now();
    let result: any;
    try {
      result = original.apply(this, args);
    } catch (e) {
      record(name, 'sim', t0, performance.now() - t0, undefined, true);
      throw e;
    }
    if (result && typeof result.then === 'function') {
      return result.then(
        (v: any) => { record(name, 'sim', t0, performance.now() - t0); return v; },
        (e: any) => { record(name, 'sim', t0, performance.now() - t0, undefined, true); throw e; },
      );
    }
    record(name, 'sim', t0, performance.now() - t0);
    return result;
  };
  proto[method].__profiled = true;
  return () => { proto[method] = original; };
}

/**
 * Wrap every method on an ACIRCallback (oracle) object with profiling.
 * The callback is Record<string, (...args) => Promise<...>>.
 * Each key is an oracle function name (getNotes, getPublicDataTreeWitness, etc.).
 */
function wrapOracleCallback(
  callback: any,
  record: RecordFn,
  isRecording: IsRecording,
): any {
  if (!callback || typeof callback !== 'object') return callback;

  const wrapped: any = {};
  for (const key of Object.keys(callback)) {
    const original = callback[key];
    if (typeof original !== 'function') {
      wrapped[key] = original;
      continue;
    }
    wrapped[key] = async function (...args: any[]) {
      if (!isRecording()) return original.apply(this, args);
      const t0 = performance.now();
      try {
        const result = await original.apply(this, args);
        record(key, 'oracle', t0, performance.now() - t0);
        return result;
      } catch (e) {
        record(key, 'oracle', t0, performance.now() - t0, undefined, true);
        throw e;
      }
    };
  }
  return wrapped;
}

/**
 * Patch circuit simulator prototypes by reaching through the PXE instance.
 * This avoids importing @aztec/simulator or @aztec/pxe/server (which have
 * native Node.js deps that break browser builds).
 *
 * Patches:
 *   - executeUserCircuit: records the circuit execution + wraps the oracle
 *     callback so every oracle call (getNotes, getPublicDataTreeWitness, etc.)
 *     gets its own span.
 *   - executeProtocolCircuit: records protocol circuit execution.
 */
export function installSimulatorInterceptorFromPXE(
  pxe: any,
  record: RecordFn,
  isRecording: IsRecording,
): () => void {
  const restores: (() => void)[] = [];

  const sim = pxe?.simulator;
  if (!sim) return () => {};

  const simProto = Object.getPrototypeOf(sim);
  if (!simProto) return () => {};

  // executeUserCircuit(input, artifact, callback)
  // We wrap the method AND the oracle callback (3rd arg).
  if (typeof simProto.executeUserCircuit === 'function' && !simProto.executeUserCircuit.__profiled) {
    const original = simProto.executeUserCircuit;
    simProto.executeUserCircuit = async function (this: any, input: any, artifact: any, callback: any, ...rest: any[]) {
      if (!isRecording()) return original.call(this, input, artifact, callback, ...rest);

      const name = artifact?.name ?? artifact?.functionName ?? 'circuit';
      const contract = artifact?.contractName ?? '';
      const label = contract ? `${contract}:${name}` : name;
      const wrappedCallback = wrapOracleCallback(callback, record, isRecording);

      const t0 = performance.now();
      try {
        const result = await original.call(this, input, artifact, wrappedCallback, ...rest);
        record(label, 'sim', t0, performance.now() - t0);
        return result;
      } catch (e) {
        record(label, 'sim', t0, performance.now() - t0, undefined, true);
        throw e;
      }
    };
    simProto.executeUserCircuit.__profiled = true;
    restores.push(() => { simProto.executeUserCircuit = original; });
  }

  // executeProtocolCircuit(input, artifact, callback)
  if (typeof simProto.executeProtocolCircuit === 'function' && !simProto.executeProtocolCircuit.__profiled) {
    const original = simProto.executeProtocolCircuit;
    simProto.executeProtocolCircuit = async function (this: any, input: any, artifact: any, callback: any, ...rest: any[]) {
      if (!isRecording()) return original.call(this, input, artifact, callback, ...rest);

      const label = artifact?.name ?? 'protocol_circuit';
      // Protocol circuits also get oracle callback wrapping (for ForeignCallHandler)
      const wrappedCallback = callback && typeof callback === 'object'
        ? wrapOracleCallback(callback, record, isRecording)
        : callback;

      const t0 = performance.now();
      try {
        const result = await original.call(this, input, artifact, wrappedCallback, ...rest);
        record(label, 'sim', t0, performance.now() - t0);
        return result;
      } catch (e) {
        record(label, 'sim', t0, performance.now() - t0, undefined, true);
        throw e;
      }
    };
    simProto.executeProtocolCircuit.__profiled = true;
    restores.push(() => { simProto.executeProtocolCircuit = original; });
  }

  return () => restores.forEach((r) => r());
}
