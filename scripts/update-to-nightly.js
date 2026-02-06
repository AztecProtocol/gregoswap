#!/usr/bin/env node

/**
 * Update gregoswap to the latest Aztec nightly version.
 *
 * Usage:
 *   node scripts/update-to-nightly.js [--version VERSION] [--deploy] [--skip-aztec-up]
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Color codes
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};

function log(color, message) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function exec(command, options = {}) {
  return execSync(command, {
    cwd: ROOT,
    stdio: options.silent ? "pipe" : "inherit",
    encoding: "utf-8",
    ...options,
  });
}

async function fetchLatestNightly() {
  log(COLORS.yellow, "Fetching latest nightly from npm...");
  try {
    const output = exec("npm view @aztec/aztec.js versions --json", { silent: true });
    const versions = JSON.parse(output);
    const nightlies = versions.filter((v) => v.match(/^4\.0\.0-nightly\.\d+$/));
    const latest = nightlies[nightlies.length - 1];
    if (!latest) {
      throw new Error("No nightly versions found");
    }
    return latest;
  } catch (error) {
    log(COLORS.red, "Failed to fetch latest nightly version from npm");
    log(COLORS.red, "Please specify a version with --version");
    process.exit(1);
  }
}

function updatePackageJson(version) {
  log(COLORS.yellow, "[1/7] Updating package.json...");
  const path = resolve(ROOT, "package.json");
  let content = readFileSync(path, "utf-8");

  // Update dependencies
  content = content.replace(
    /@aztec\/([^"]+)": "v4\.0\.0-nightly\.\d+"/g,
    `@aztec/$1": "v${version}"`
  );

  // Update version in copy:dependencies script
  content = content.replace(/v4\.0\.0-nightly\.\d+/g, `v${version}`);

  writeFileSync(path, content, "utf-8");
  log(COLORS.green, "✓ package.json updated\n");
}

function updateNargoToml(version) {
  log(COLORS.yellow, "[2/7] Updating Nargo.toml files...");
  const path = resolve(ROOT, "contracts/proof_of_password/Nargo.toml");
  let content = readFileSync(path, "utf-8");

  content = content.replace(/tag = "v4\.0\.0-nightly\.\d+"/g, `tag = "v${version}"`);

  writeFileSync(path, content, "utf-8");
  log(COLORS.green, "✓ Nargo.toml files updated\n");
}

function updateReadme(version) {
  log(COLORS.yellow, "[3/7] Updating README.md...");
  const path = resolve(ROOT, "README.md");
  let content = readFileSync(path, "utf-8");

  content = content.replace(/v4\.0\.0-nightly\.\d+/g, `v${version}`);

  writeFileSync(path, content, "utf-8");
  log(COLORS.green, "✓ README.md updated\n");
}

function installDependencies() {
  log(COLORS.yellow, "[4/7] Running yarn install...");
  exec("yarn install");
  log(COLORS.green, "✓ Dependencies installed\n");
}

function installAztecCLI(version) {
  log(COLORS.yellow, `[5/7] Installing Aztec CLI version ${version}...`);

  const isCI = !!process.env.CI;

  if (isCI) {
    // CI environment - use direct curl install
    log(COLORS.yellow, `Running version-specific installer for ${version}...`);
    process.env.FOUNDRY_DIR = `${process.env.HOME}/.foundry`;
    exec(`curl -fsSL "https://install.aztec.network/${version}/install" | VERSION="${version}" bash`);

    // Update PATH for current session
    process.env.PATH = `${process.env.HOME}/.aztec/versions/${version}/bin:${process.env.PATH}`;
    process.env.PATH = `${process.env.HOME}/.aztec/versions/${version}/node_modules/.bin:${process.env.PATH}`;
    log(COLORS.green, "✓ Aztec CLI installed (CI mode)\n");
  } else {
    // Local environment with aztec-up
    try {
      exec("command -v aztec-up", { silent: true });
      exec(`aztec-up install ${version}`);
      log(COLORS.green, "✓ Aztec CLI updated\n");
    } catch {
      log(COLORS.red, `Warning: aztec-up not found in PATH. Please install manually with: aztec-up install ${version}\n`);
    }
  }
}

function compileContracts() {
  log(COLORS.yellow, "[6/7] Compiling contracts...");
  exec("yarn compile:contracts");
  log(COLORS.green, "✓ Contracts compiled\n");
}

function deployToNextnet() {
  log(COLORS.yellow, "[7/7] Deploying to nextnet...");
  if (!process.env.PASSWORD) {
    log(COLORS.red, "ERROR: PASSWORD environment variable not set");
    log(COLORS.red, "Please set PASSWORD before running with --deploy flag");
    process.exit(1);
  }
  exec("yarn deploy:nextnet");
  log(COLORS.green, "✓ Deployed to nextnet\n");
}

async function main() {
  log(COLORS.green, "=== Gregoswap Nightly Update Script ===\n");

  // Parse arguments
  const args = process.argv.slice(2);
  let version = null;
  let deploy = false;
  let skipAztecUp = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) {
      version = args[i + 1].replace(/^v/, "");
      i++;
    } else if (args[i] === "--deploy") {
      deploy = true;
    } else if (args[i] === "--skip-aztec-up") {
      skipAztecUp = true;
    } else if (args[i] === "--help") {
      console.log("Usage: node scripts/update-to-nightly.js [OPTIONS]");
      console.log("\nOptions:");
      console.log("  --version VERSION    Specify nightly version (e.g., 4.0.0-nightly.20260206)");
      console.log("  --deploy             Deploy to nextnet after update");
      console.log("  --skip-aztec-up      Skip Aztec CLI installation");
      console.log("  --help               Show this help message");
      process.exit(0);
    }
  }

  // Fetch latest if not specified
  if (!version) {
    version = await fetchLatestNightly();
    log(COLORS.green, `Latest nightly version: v${version}\n`);
  } else {
    log(COLORS.green, `Updating to version: v${version}\n`);
  }

  // Run update steps
  updatePackageJson(version);
  updateNargoToml(version);
  updateReadme(version);
  installDependencies();

  if (!skipAztecUp) {
    installAztecCLI(version);
  } else {
    log(COLORS.yellow, "[5/7] Skipping Aztec CLI installation (--skip-aztec-up flag set)\n");
  }

  compileContracts();

  if (deploy) {
    deployToNextnet();
  } else {
    log(COLORS.yellow, "[7/7] Skipping deployment (use --deploy flag to deploy)\n");
  }

  log(COLORS.green, "=== Update Complete ===");
  log(COLORS.green, `Version: v${version}`);
  if (!deploy) {
    log(COLORS.yellow, "To deploy to nextnet, run: PASSWORD=<password> node scripts/update-to-nightly.js --deploy");
  }
}

main().catch((error) => {
  log(COLORS.red, `Error: ${error.message}`);
  process.exit(1);
});
