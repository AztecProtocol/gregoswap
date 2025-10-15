import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { PolyfillOptions, nodePolyfills } from 'vite-plugin-node-polyfills';
import bundlesize from 'vite-plugin-bundlesize';

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
    },
    optimizeDeps: {
      exclude: ['@aztec/noir-acvm_js', '@aztec/noir-noirc_abi'],
    },
    plugins: [
      react({ jsxImportSource: '@emotion/react' }),
      nodePolyfillsFix({ include: ['buffer', 'path'] }),
      bundlesize({
        limits: [
          // Main entrypoint, hard limit
          { name: 'assets/index-*', limit: '1750kB' },
          { name: '**/*', limit: '4000kB' },
        ],
      }),
    ],
    define: {
      'process.env': JSON.stringify({
        LOG_LEVEL: env.LOG_LEVEL,
      }),
    },
    build: {
      // Required by vite-plugin-bundle-size
      sourcemap: 'hidden',
    },
  };
});
