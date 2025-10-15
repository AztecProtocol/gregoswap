/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZTEC_NODE_URL: string;
  readonly VITE_GREGOCOIN_ADDRESS: string;
  readonly VITE_GREGOCOIN_PREMIUM_ADDRESS: string;
  readonly VITE_AMM_ADDRESS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
