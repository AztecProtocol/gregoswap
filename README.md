# GregoSwap

A decentralized token swap application built on the Aztec blockchain featuring private token swaps and a proof-of-password token faucet.

## Features

- **Private Token Swaps**: Swap between GregoCoin (GRG) and GregoCoinPremium (GRGP) using an Automated Market Maker (AMM)
- **Token Faucet**: Claim free GregoCoin tokens using a proof-of-password mechanism
- **Wallet Integration**: Connect with Aztec wallet extensions or use an embedded wallet
- **Multi-Flow Onboarding**: Seamless onboarding experience that adapts based on user's token balance

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 22 or higher
- **Yarn**: Version 4.5.2 (via Corepack)
- **Aztec CLI**: Required for compiling contracts and running local sandbox

## Installation

### 1. Install Dependencies

```bash
yarn install
```

### 2. Install Aztec CLI

```bash
curl -s https://install.aztec.network | bash
```

### 3. Set Aztec Version

The project uses Aztec version `v3.0.0-devnet.20251212`. Set it using:

```bash
aztec-up 3.0.0-devnet.20251212
```

## Development Setup

### Running Locally with Aztec Sandbox

#### 1. Start the Aztec Sandbox

In a separate terminal, start the local Aztec sandbox:

```bash
aztec start --sandbox
```

This will start a local Aztec node on `http://localhost:8080`.

**Note**: Keep this terminal running while developing. The local node must be running for contract deployment and local testing.

#### 2. Compile Contracts

In your main terminal, compile the smart contracts:

```bash
yarn compile:contracts
```

This will:

- Compile the Noir contracts in the `contracts/` directory
- Generate TypeScript bindings for contract interaction
- Output compiled artifacts to `contracts/target/`

#### 3. Deploy Contracts Locally

Set a password for the proof-of-password contract and deploy:

```bash
PASSWORD=your-secret-password PROVER_ENABLED=false yarn deploy:local
```

**Important**: Remember this password! You'll need it to claim tokens through the faucet.

This will:

- Deploy GregoCoin and GregoCoinPremium token contracts
- Deploy the AMM (Automated Market Maker) contract
- Deploy the ProofOfPassword contract
- Generate a `deployed-addresses.json` file with contract addresses

#### 4. Start the Development Server

```bash
yarn serve
```
