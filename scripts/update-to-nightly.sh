#!/usr/bin/env bash
set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${GREEN}=== Gregoswap Nightly Update Script ===${NC}\n"

# Parse arguments
VERSION=""
DEPLOY=false
SKIP_AZTEC_UP=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --deploy)
      DEPLOY=true
      shift
      ;;
    --skip-aztec-up)
      SKIP_AZTEC_UP=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Usage: $0 [--version VERSION] [--deploy] [--skip-aztec-up]"
      echo "  --version VERSION    Specify nightly version (e.g., 4.0.0-nightly.20260206)"
      echo "  --deploy             Run deployment to nextnet after update"
      echo "  --skip-aztec-up      Skip running aztec-up (useful in CI)"
      exit 1
      ;;
  esac
done

# If no version specified, try to get the latest from npm
if [[ -z "$VERSION" ]]; then
  echo -e "${YELLOW}No version specified, fetching latest nightly from npm...${NC}"
  VERSION=$(npm view @aztec/aztec.js versions --json | grep -o '"v4.0.0-nightly.[0-9]*"' | tail -1 | tr -d '"')
  if [[ -z "$VERSION" ]]; then
    echo -e "${RED}Failed to fetch latest nightly version${NC}"
    exit 1
  fi
  echo -e "${GREEN}Latest nightly version: ${VERSION}${NC}\n"
fi

# Remove 'v' prefix if present
VERSION="${VERSION#v}"
VERSION_WITH_V="v${VERSION}"

echo -e "${GREEN}Updating to version: ${VERSION_WITH_V}${NC}\n"

cd "$REPO_ROOT"

# Step 1: Update package.json
echo -e "${YELLOW}[1/7] Updating package.json...${NC}"
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  # Update dependencies
  sed -i '' "s/@aztec\/\([^\"]*\)\":[ ]*\"v4\.0\.0-nightly\.[0-9]*\"/@aztec\/\1\": \"${VERSION_WITH_V}\"/g" package.json
  # Update version in copy:dependencies script
  sed -i '' "s/v4\.0\.0-nightly\.[0-9]*/v${VERSION}/g" package.json
else
  # Linux
  # Update dependencies
  sed -i "s/@aztec\/\([^\"]*\)\":[ ]*\"v4\.0\.0-nightly\.[0-9]*\"/@aztec\/\1\": \"${VERSION_WITH_V}\"/g" package.json
  # Update version in copy:dependencies script
  sed -i "s/v4\.0\.0-nightly\.[0-9]*/v${VERSION}/g" package.json
fi
echo -e "${GREEN}✓ package.json updated${NC}\n"

# Step 2: Update Nargo.toml
echo -e "${YELLOW}[2/7] Updating Nargo.toml files...${NC}"
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' "s/tag = \"v4\.0\.0-nightly\.[0-9]*\"/tag = \"${VERSION_WITH_V}\"/g" contracts/proof_of_password/Nargo.toml
else
  # Linux
  sed -i "s/tag = \"v4\.0\.0-nightly\.[0-9]*\"/tag = \"${VERSION_WITH_V}\"/g" contracts/proof_of_password/Nargo.toml
fi
echo -e "${GREEN}✓ Nargo.toml files updated${NC}\n"

# Step 3: Update README.md
echo -e "${YELLOW}[3/7] Updating README.md...${NC}"
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' "s/v4\.0\.0-nightly\.[0-9]*/${VERSION_WITH_V}/g" README.md
else
  # Linux
  sed -i "s/v4\.0\.0-nightly\.[0-9]*/${VERSION_WITH_V}/g" README.md
fi
echo -e "${GREEN}✓ README.md updated${NC}\n"

# Step 4: Install dependencies
echo -e "${YELLOW}[4/7] Running yarn install...${NC}"
yarn install
echo -e "${GREEN}✓ Dependencies installed${NC}\n"

# Step 5: Update aztec CLI (unless skipped)
if [[ "$SKIP_AZTEC_UP" == false ]]; then
  echo -e "${YELLOW}[5/7] Running aztec-up to install ${VERSION}...${NC}"
  if command -v aztec-up &> /dev/null; then
    aztec-up install "${VERSION}"
    echo -e "${GREEN}✓ Aztec CLI updated${NC}\n"
  else
    echo -e "${RED}Warning: aztec-up not found in PATH. Please install manually with: aztec-up install ${VERSION}${NC}\n"
  fi
else
  echo -e "${YELLOW}[5/7] Skipping aztec-up (--skip-aztec-up flag set)${NC}\n"
fi

# Step 6: Compile contracts
echo -e "${YELLOW}[6/7] Compiling contracts...${NC}"
yarn compile:contracts
echo -e "${GREEN}✓ Contracts compiled${NC}\n"

# Step 7: Deploy (if requested)
if [[ "$DEPLOY" == true ]]; then
  echo -e "${YELLOW}[7/7] Deploying to nextnet...${NC}"
  if [[ -z "${PASSWORD:-}" ]]; then
    echo -e "${RED}ERROR: PASSWORD environment variable not set${NC}"
    echo "Please set PASSWORD before running with --deploy flag"
    exit 1
  fi
  yarn deploy:nextnet
  echo -e "${GREEN}✓ Deployed to nextnet${NC}\n"
else
  echo -e "${YELLOW}[7/7] Skipping deployment (use --deploy flag to deploy)${NC}\n"
fi

echo -e "${GREEN}=== Update Complete ===${NC}"
echo -e "Version: ${VERSION_WITH_V}"
if [[ "$DEPLOY" == true ]]; then
  echo -e "${GREEN}Contracts deployed to nextnet${NC}"
else
  echo -e "${YELLOW}To deploy to nextnet, run: PASSWORD=<password> yarn deploy:nextnet${NC}"
fi
