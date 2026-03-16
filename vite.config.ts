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
        return `./node_modules/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.cjs`;
      }
    },
  };
};

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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    logLevel: process.env.CI ? 'error' : undefined,
    server: {
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
      exclude: ['@aztec/noir-acvm_js', '@aztec/noir-noirc_abi', '@aztec/bb.js'],
    },
    plugins: [
      react({ jsxImportSource: '@emotion/react' }),
      nodePolyfillsFix({ include: ['buffer', 'path'] }),
      chunkSizeValidator([
        {
          pattern: /assets\/index-.*\.js$/,
          maxSizeKB: 1500,
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
