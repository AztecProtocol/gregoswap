#!/usr/bin/env node

/**
 * Toggle local aztec-packages resolutions in package.json and vite.config.ts.
 *
 * Usage:
 *   node scripts/toggle-local-aztec.js enable /path/to/aztec-packages
 *   node scripts/toggle-local-aztec.js disable
 *   node scripts/toggle-local-aztec.js status
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Package.json files to modify (relative to repo root)
const PACKAGE_FILES = ["package.json"];
const VITE_CONFIG = "vite.config.ts";

// Mapping of @aztec/* packages to their paths within aztec-packages
const PACKAGE_MAPPINGS = {
  "@aztec/accounts": "yarn-project/accounts",
  "@aztec/archiver": "yarn-project/archiver",
  "@aztec/aztec.js": "yarn-project/aztec.js",
  "@aztec/bb.js": "barretenberg/ts",
  "@aztec/bb-prover": "yarn-project/bb-prover",
  "@aztec/blob-client": "yarn-project/blob-client",
  "@aztec/blob-lib": "yarn-project/blob-lib",
  "@aztec/builder": "yarn-project/builder",
  "@aztec/constants": "yarn-project/constants",
  "@aztec/entrypoints": "yarn-project/entrypoints",
  "@aztec/epoch-cache": "yarn-project/epoch-cache",
  "@aztec/ethereum": "yarn-project/ethereum",
  "@aztec/foundation": "yarn-project/foundation",
  "@aztec/key-store": "yarn-project/key-store",
  "@aztec/kv-store": "yarn-project/kv-store",
  "@aztec/l1-artifacts": "yarn-project/l1-artifacts",
  "@aztec/merkle-tree": "yarn-project/merkle-tree",
  "@aztec/native": "yarn-project/native",
  "@aztec/noir-acvm_js": "noir/packages/acvm_js",
  "@aztec/noir-contracts.js": "yarn-project/noir-contracts.js",
  "@aztec/noir-noir_codegen": "noir/packages/noir_codegen",
  "@aztec/noir-noirc_abi": "noir/packages/noirc_abi",
  "@aztec/noir-protocol-circuits-types": "yarn-project/noir-protocol-circuits-types",
  "@aztec/noir-types": "noir/packages/types",
  "@aztec/node-keystore": "yarn-project/node-keystore",
  "@aztec/node-lib": "yarn-project/node-lib",
  "@aztec/p2p": "yarn-project/p2p",
  "@aztec/protocol-contracts": "yarn-project/protocol-contracts",
  "@aztec/prover-client": "yarn-project/prover-client",
  "@aztec/pxe": "yarn-project/pxe",
  "@aztec/sequencer-client": "yarn-project/sequencer-client",
  "@aztec/simulator": "yarn-project/simulator",
  "@aztec/slasher": "yarn-project/slasher",
  "@aztec/stdlib": "yarn-project/stdlib",
  "@aztec/telemetry-client": "yarn-project/telemetry-client",
  "@aztec/test-wallet": "yarn-project/test-wallet",
  "@aztec/validator-client": "yarn-project/validator-client",
  "@aztec/wallet-sdk": "yarn-project/wallet-sdk",
  "@aztec/world-state": "yarn-project/world-state",
};

// Paths within aztec-packages that need to be allowed in vite's fs.allow
const VITE_FS_ALLOW_PATHS = [
  "yarn-project/noir-protocol-circuits-types/artifacts",
  "noir/packages/noirc_abi/web",
  "noir/packages/acvm_js/web",
  "barretenberg/ts/dest/browser",
];

function readPackageJson(filePath) {
  const fullPath = resolve(ROOT, filePath);
  if (!existsSync(fullPath)) {
    return null;
  }
  return JSON.parse(readFileSync(fullPath, "utf-8"));
}

function writePackageJson(filePath, data) {
  const fullPath = resolve(ROOT, filePath);
  writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n");
}

function generateResolutions(aztecPath) {
  const resolutions = {};
  for (const [pkg, subPath] of Object.entries(PACKAGE_MAPPINGS)) {
    resolutions[pkg] = `link:${aztecPath}/${subPath}`;
  }
  return resolutions;
}

function updateViteConfig(aztecPath) {
  const viteConfigPath = resolve(ROOT, VITE_CONFIG);
  if (!existsSync(viteConfigPath)) {
    console.log(`Skipping ${VITE_CONFIG} (not found)`);
    return;
  }

  let content = readFileSync(viteConfigPath, "utf-8");

  // Generate the new fs.allow array content
  const fsAllowPaths = VITE_FS_ALLOW_PATHS.map(
    (p) => `          '${aztecPath}/${p}',`
  ).join("\n");

  const newFsAllowBlock = `fs: {
        allow: [
          searchForWorkspaceRoot(process.cwd()),
${fsAllowPaths}
        ],
      },`;

  // Replace the existing fs block using regex
  const fsBlockRegex = /fs:\s*\{[\s\S]*?allow:\s*\[[\s\S]*?\],[\s\S]*?\},/;

  if (fsBlockRegex.test(content)) {
    content = content.replace(fsBlockRegex, newFsAllowBlock);
    writeFileSync(viteConfigPath, content);
    console.log(`Updated vite.config.ts with aztec-packages paths`);
  } else {
    console.log(`Warning: Could not find fs.allow block in vite.config.ts`);
  }
}

function removeViteFsAllow() {
  const viteConfigPath = resolve(ROOT, VITE_CONFIG);
  if (!existsSync(viteConfigPath)) {
    console.log(`Skipping ${VITE_CONFIG} (not found)`);
    return;
  }

  let content = readFileSync(viteConfigPath, "utf-8");

  // Replace with minimal fs.allow block (just searchForWorkspaceRoot)
  const minimalFsAllowBlock = `fs: {
        allow: [searchForWorkspaceRoot(process.cwd())],
      },`;

  const fsBlockRegex = /fs:\s*\{[\s\S]*?allow:\s*\[[\s\S]*?\],[\s\S]*?\},/;

  if (fsBlockRegex.test(content)) {
    content = content.replace(fsBlockRegex, minimalFsAllowBlock);
    writeFileSync(viteConfigPath, content);
    console.log(`Removed aztec-packages paths from vite.config.ts`);
  } else {
    console.log(`Warning: Could not find fs.allow block in vite.config.ts`);
  }
}

function getViteFsAllowStatus() {
  const viteConfigPath = resolve(ROOT, VITE_CONFIG);
  if (!existsSync(viteConfigPath)) {
    return null;
  }

  const content = readFileSync(viteConfigPath, "utf-8");

  // Look for aztec-packages paths in the fs.allow block
  const match = content.match(/allow:\s*\[[\s\S]*?'([^']+\/(?:yarn-project|barretenberg|noir))/);
  if (match) {
    // Extract the base path
    const fullPath = match[1];
    const baseMatch = fullPath.match(/^(.+?)\/(?:yarn-project|barretenberg|noir)/);
    return baseMatch ? baseMatch[1] : "unknown";
  }

  return null;
}

function enable(aztecPath) {
  if (!aztecPath) {
    console.error("Error: aztec-packages path is required for enable command");
    console.error("Usage: node scripts/toggle-local-aztec.js enable /path/to/aztec-packages");
    process.exit(1);
  }

  const resolvedPath = resolve(aztecPath);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: Path does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  if (!existsSync(resolve(resolvedPath, "yarn-project"))) {
    console.error(`Error: Path does not appear to be aztec-packages: ${resolvedPath}`);
    process.exit(1);
  }

  const resolutions = generateResolutions(resolvedPath);

  for (const file of PACKAGE_FILES) {
    const pkg = readPackageJson(file);
    if (!pkg) {
      console.log(`Skipping ${file} (not found)`);
      continue;
    }

    pkg.resolutions = resolutions;
    writePackageJson(file, pkg);
    console.log(`Enabled local resolutions in ${file}`);
  }

  updateViteConfig(resolvedPath);

  console.log(`\nLocal aztec-packages resolutions enabled.`);
  console.log(`Path: ${resolvedPath}`);
  console.log(`\nRun 'yarn install' to apply changes.`);
}

function disable() {
  for (const file of PACKAGE_FILES) {
    const pkg = readPackageJson(file);
    if (!pkg) {
      console.log(`Skipping ${file} (not found)`);
      continue;
    }

    if (pkg.resolutions) {
      delete pkg.resolutions;
      writePackageJson(file, pkg);
      console.log(`Disabled local resolutions in ${file}`);
    } else {
      console.log(`No resolutions to remove in ${file}`);
    }
  }

  removeViteFsAllow();

  console.log(`\nLocal aztec-packages resolutions disabled.`);
  console.log(`\nRun 'yarn install' to apply changes.`);
}

function status() {
  for (const file of PACKAGE_FILES) {
    const pkg = readPackageJson(file);
    if (!pkg) {
      console.log(`${file}: not found`);
      continue;
    }

    if (pkg.resolutions && Object.keys(pkg.resolutions).length > 0) {
      const firstResolution = Object.values(pkg.resolutions)[0];
      const match = firstResolution.match(/^link:(.+?)\/(?:yarn-project|barretenberg|noir)/);
      const path = match ? match[1] : "unknown";
      console.log(`${file}: ENABLED (${path})`);
    } else {
      console.log(`${file}: disabled`);
    }
  }

  const vitePath = getViteFsAllowStatus();
  if (vitePath) {
    console.log(`${VITE_CONFIG}: ENABLED (${vitePath})`);
  } else {
    console.log(`${VITE_CONFIG}: disabled`);
  }
}

// Main
const [, , command, aztecPath] = process.argv;

switch (command) {
  case "enable":
    enable(aztecPath);
    break;
  case "disable":
    disable();
    break;
  case "status":
    status();
    break;
  default:
    console.log("Toggle local aztec-packages resolutions in package.json and vite.config.ts.");
    console.log("");
    console.log("Usage:");
    console.log("  node scripts/toggle-local-aztec.js enable /path/to/aztec-packages");
    console.log("  node scripts/toggle-local-aztec.js disable");
    console.log("  node scripts/toggle-local-aztec.js status");
    process.exit(1);
}
