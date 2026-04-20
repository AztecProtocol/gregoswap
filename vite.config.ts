import { defineConfig, loadEnv, Plugin, ResolvedConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { PolyfillOptions, nodePolyfills } from 'vite-plugin-node-polyfills';
import fs from 'fs';
import path from 'path';

// Unfortunate, but needed due to https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81
// Suspected to be because of the yarn workspace setup, but not sure
const nodePolyfillsFix = (options?: PolyfillOptions | undefined): Plugin => {
  return {
    ...nodePolyfills(options),
    /* @ts-ignore */
    resolveId(source: string) {
      const m = /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(source);
      if (m) {
        return path.resolve(
          process.cwd(),
          `node_modules/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.cjs`,
        );
      }
    },
  };
};

/**
 * Loads resolve aliases for transitive aztec-packages workspace deps that yarn `link:`
 * doesn't surface to gregoswap's node_modules. Reads the aztec-packages root from
 * `.local-aztec-path` (written by `scripts/toggle-local-aztec.js enable`). Returns `{}`
 * when the file doesn't exist (local-aztec disabled), leaving npm resolutions active.
 */
function loadLocalAztecAliases(): Record<string, string> {
  try {
    const root = fs.readFileSync(path.resolve(process.cwd(), '.local-aztec-path'), 'utf-8').trim();
    if (!root) {
      return {};
    }
    return {
      '@aztec/bb.js': `${root}/barretenberg/ts/dest/browser/index.js`,
      '@aztec/noir-acvm_js': `${root}/noir/packages/acvm_js/web/acvm_js.js`,
      '@aztec/noir-noirc_abi': `${root}/noir/packages/noirc_abi/web/noirc_abi_wasm.js`,
      '@sqlite.org/sqlite-wasm': `${root}/yarn-project/node_modules/@sqlite.org/sqlite-wasm/index.mjs`,
    };
  } catch {
    // No .local-aztec-path file — we're using npm packages, no aliases needed.
    return {};
  }
}

/**
 * Force `Content-Type: application/wasm` on `.wasm` files served by Vite's dev server.
 * Without this, `WebAssembly.compileStreaming()` (used by sqlite-wasm and others)
 * rejects the response with "Incorrect response MIME type. Expected 'application/wasm'".
 * Vite's dev middleware doesn't set this header by default for files served from
 * aliased / @fs paths outside node_modules.
 */
const wasmContentTypePlugin = (): Plugin => ({
  name: 'wasm-content-type',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.includes('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
      }
      next();
    });
  },
});

/**
 * Lightweight chunk size validator plugin
 * Checks chunk sizes after build completes and fails if limits are exceeded
 */
interface ChunkSizeLimit {
  /** Pattern to match chunk file names (e.g., /assets\/index-.*\.js$/) */
  pattern: RegExp;
  /** Maximum size in kilobytes */
  maxSizeKB: number;
  /** Optional description for logging */
  description?: string;
}

const chunkSizeValidator = (limits: ChunkSizeLimit[]): Plugin => {
  let config: ResolvedConfig;

  return {
    name: 'chunk-size-validator',
    enforce: 'post',
    apply: 'build',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    closeBundle() {
      const outDir = this.meta?.watchMode ? null : 'dist';
      if (!outDir) return; // Skip in watch mode

      const logger = config.logger;
      const violations: string[] = [];
      const checkDir = (dir: string, baseDir: string = '') => {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          const filePath = path.join(dir, file);
          const relativePath = path.join(baseDir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
            checkDir(filePath, relativePath);
          } else if (stat.isFile()) {
            const sizeKB = stat.size / 1024;

            for (const limit of limits) {
              if (limit.pattern.test(relativePath)) {
                const desc = limit.description ? ` (${limit.description})` : '';
                logger.info(`  ${relativePath}: ${sizeKB.toFixed(2)} KB / ${limit.maxSizeKB} KB${desc}`);

                if (sizeKB > limit.maxSizeKB) {
                  violations.push(
                    `  ❌ ${relativePath}: ${sizeKB.toFixed(2)} KB exceeds limit of ${limit.maxSizeKB} KB${desc}`,
                  );
                }
              }
            }
          }
        }
      };

      logger.info('\n📦 Validating chunk sizes...');
      checkDir(path.resolve(process.cwd(), outDir));

      if (violations.length > 0) {
        logger.error('\n❌ Chunk size validation failed:\n');
        violations.forEach(v => logger.error(v));
        logger.error('\n');
        throw new Error('Build failed: chunk size limits exceeded');
      } else {
        logger.info('✅ All chunks within size limits\n');
      }
    },
  };
};

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Profiling (zone.js-based async context tracking) runs only in dev.
  // V8's "fast await" optimization bypasses user-space Promise.prototype.then
  // for native `async function` bodies, breaking zone.js propagation. By
  // lowering the esbuild/SWC target to es2016 in dev, we force async/await
  // to be transpiled to Promise-based state machines that DO go through
  // user-level .then() — which zone.js can hook. Prod keeps esnext for speed.
  const isDev = command === 'serve';
  const esTarget = isDev ? 'es2016' : 'esnext';

  const localAztecAliases = loadLocalAztecAliases();

  return {
    base: './',
    logLevel: process.env.CI ? 'error' : undefined,
    esbuild: { target: esTarget },
    build: { target: esTarget },
    resolve: {
      alias: localAztecAliases,
    },
    server: {
      // Bind on 0.0.0.0 so a tunnel (ngrok, cloudflared) or same-network device
      // (e.g. iPhone with mkcert-trusted HTTPS) can reach the dev server.
      host: true,
      // Accept Host headers from tunnel providers without needing per-URL config.
      // Wildcards cover rotating ngrok-free subdomains; trycloudflare.com covers
      // ephemeral Cloudflare tunnels. Tighten if you want to restrict further.
      allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com'],
      // Headers needed for bb WASM to work in multithreaded mode
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      fs: {
        allow: [searchForWorkspaceRoot(process.cwd())],
      },
    },
    optimizeDeps: {
      // @sqlite.org/sqlite-wasm must be excluded: Vite's prebundle extracts the JS
      // into .vite/deps/ but doesn't copy the adjacent sqlite3.wasm binary, so the
      // generated fetch URL 404s. Excluding keeps the JS at its real location where
      // the .wasm sits next to it.
      exclude: ['@aztec/noir-acvm_js', '@aztec/noir-noirc_abi', '@aztec/bb.js', '@sqlite.org/sqlite-wasm'],
      include: ['@gregojuice/embedded-wallet/ui'],
      esbuildOptions: { target: esTarget },
    },
    plugins: [
      react({
        jsxImportSource: '@emotion/react',
        // Match esbuild target in dev so async/await gets transpiled for zone.js.
        ...(isDev ? { devTarget: 'es2016' as const } : {}),
      }),
      nodePolyfillsFix({ include: ['buffer', 'path'] }),
      wasmContentTypePlugin(),
      chunkSizeValidator([
        {
          pattern: /assets\/index-.*\.js$/,
          maxSizeKB: 1700,
          description: 'Main entrypoint, hard limit',
        },
        {
          pattern: /.*/,
          maxSizeKB: 8000,
          description: 'Detect if json artifacts or bb.js wasm get out of control',
        },
      ]),
    ],
    define: {
      'process.env': JSON.stringify({
        LOG_LEVEL: env.LOG_LEVEL,
      }),
    },
  };
});
