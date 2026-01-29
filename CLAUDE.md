# Claude Context: GregoSwap

## Project Overview

GregoSwap is a decentralized token swap application built on the Aztec blockchain. It demonstrates private token swaps using an Automated Market Maker (AMM), with a token faucet (drip) mechanism using proof-of-password.

**Key Features:**

- Private token swaps (GregoCoin ↔ GregoCoinPremium) via AMM
- Token faucet with proof-of-password (PoP) contract
- Multi-flow onboarding supporting embedded and external wallets
- Network switching (local sandbox / devnet)

**Tech Stack:**

- React 18 + TypeScript
- Material-UI (MUI) component library
- Vite build tooling
- Aztec SDK (@aztec/aztec.js, @aztec/wallet-sdk)
- Yarn 4.5.2 package manager

## Architecture

### Layer Overview

```
src/
├── contexts/          # State management (Context + Reducer pattern)
├── services/          # Pure functions for wallet/contract operations
├── components/        # React UI components
├── config/            # Network configuration
├── types/             # Shared type definitions
└── utils/             # Utility functions
```

### Provider Hierarchy (main.tsx)

```tsx
<NetworkProvider>
  <WalletProvider>
    <ContractsProvider>
      <OnboardingProvider>
        <SwapProvider>
          <App />
        </SwapProvider>
      </OnboardingProvider>
    </ContractsProvider>
  </WalletProvider>
</NetworkProvider>
```

## State Management Pattern

Each context uses a **colocated reducer pattern** with a factory function:

```
src/contexts/
├── utils.ts                    # createReducerHook factory
├── network/
│   ├── NetworkContext.tsx      # No reducer (simple state)
│   └── index.ts
├── wallet/
│   ├── WalletContext.tsx
│   ├── reducer.ts              # State, actions, reducer, hook
│   └── index.ts
├── contracts/
│   ├── ContractsContext.tsx
│   ├── reducer.ts
│   └── index.ts
├── onboarding/
│   ├── OnboardingContext.tsx
│   ├── reducer.ts
│   └── index.ts
└── swap/
    ├── SwapContext.tsx
    ├── reducer.ts
    └── index.ts
```

### Reducer Factory Pattern (src/contexts/utils.ts)

```typescript
// Creates a hook that returns [state, boundActions] tuple
export const useSwapReducer = createReducerHook(swapReducer, swapActions, initialSwapState);

// Usage in context:
const [state, actions] = useSwapReducer();
actions.setFromAmount('100'); // Type-safe, no dispatch() needed
```

**Key benefits:**

- Type-safe action creators
- No dispatch callback boilerplate
- Actions bound automatically via `bindActions()`

### Reducer File Structure

Each reducer.ts exports:

- **State type and initial state** (e.g., `SwapState`, `initialSwapState`)
- **Actions object** with action creators (e.g., `swapActions`)
- **Action union type** via `ActionsFrom<typeof actions>`
- **Reducer function** (e.g., `swapReducer`)
- **Hook** created via `createReducerHook()` (e.g., `useSwapReducer`)

## Contexts Reference

### NetworkContext

**Purpose:** Network selection and configuration

**State:**

- `activeNetwork: NetworkConfig` - Currently selected network
- `availableNetworks: NetworkConfig[]` - All discovered networks
- `isLoading: boolean`

**Key behavior:**

- Loads network configs from `src/config/networks/deployed-addresses.json`
- Persists selection to localStorage
- Excludes local network in production builds

### WalletContext

**Purpose:** Wallet instance management (embedded vs external)

**State:**

- `wallet: Wallet | null` - Active wallet
- `node: AztecNode | null` - Aztec node client
- `currentAddress: AztecAddress | null` - Selected account
- `isUsingEmbeddedWallet: boolean` - Wallet type flag
- `isLoading: boolean` / `error: string | null`

**Key methods:**

```typescript
discoverWallets(timeout?): DiscoverySession
initiateConnection(provider): Promise<PendingConnection>
confirmConnection(provider, pending): Promise<Wallet>
cancelConnection(pending): void
setCurrentAddress(address): void
disconnectWallet(): Promise<void>
onWalletDisconnect(callback): () => void  // Returns unsubscribe
```

**Key behavior:**

- Auto-creates embedded wallet on network change
- Manages disconnect callback registry
- Reverts to embedded wallet on external disconnect

### ContractsContext

**Purpose:** Contract instances and registration

**State:**

- `contracts: { gregoCoin, gregoCoinPremium, amm, pop }`
- `isLoading: boolean`

**Key methods:**

```typescript
registerBaseContracts(): Promise<void>    // AMM + tokens
registerDripContracts(): Promise<void>    // PoP contract
getExchangeRate(): Promise<number>
fetchBalances(): Promise<[bigint, bigint]>
simulateOnboardingQueries(): Promise<[rate, gcBal, gcpBal]>
swap(amountOut, amountInMax): Promise<TxReceipt>
drip(password, recipient): Promise<TxReceipt>
```

### OnboardingContext

**Purpose:** Orchestrates multi-step onboarding flow

**Status flow:**

```
idle → connecting → registering → simulating →
  [if balance=0] → registering_drip → awaiting_drip → executing_drip →
completed
```

**State:**

- `status: OnboardingStatus` - Current flow state
- `result: OnboardingResult | null` - Simulation results
- `needsDrip: boolean` - User needs to claim tokens
- `dripPassword: string | null` - PoP password
- `dripPhase: DripPhase` - Drip execution phase
- `pendingSwap: boolean` - Swap queued after onboarding
- `hasRegisteredBase/hasSimulated` - Tracking flags

**Key behavior:**

- Effects drive automatic state transitions
- Checks balance after simulation to determine drip need
- Persists completion to localStorage per address

### SwapContext

**Purpose:** Swap UI state and execution

**State:**

- `fromAmount: string` / `toAmount: string`
- `exchangeRate: number | null`
- `isLoadingRate: boolean`
- `phase: SwapPhase` - 'idle' | 'sending' | 'success' | 'error'
- `error: string | null`

**Computed values (in context):**

- `fromAmountUSD` / `toAmountUSD`
- `canSwap` - Whether swap button is enabled
- `isSwapping` - phase === 'sending'

## Services Layer

Pure functions in `src/services/` - contexts call these:

### walletService.ts

```typescript
createNodeClient(nodeUrl): AztecNode
createEmbeddedWallet(node): Promise<EmbeddedWallet>
getChainInfo(network): ChainInfo
discoverWallets(chainInfo, timeout?): DiscoverySession
initiateConnection(provider): Promise<PendingConnection>
confirmConnection(pending): Promise<Wallet>
cancelConnection(pending): void
disconnectProvider(provider): Promise<void>
```

### contractService.ts

```typescript
// Registration
registerSwapContracts(wallet, node, network): Promise<SwapContracts>
registerDripContracts(wallet, node, network): Promise<DripContracts>

// Queries
getExchangeRate(wallet, contracts, fromAddress): Promise<number>
fetchBalances(wallet, contracts, address): Promise<[bigint, bigint]>
simulateOnboardingQueries(wallet, contracts, address): Promise<OnboardingResult>

// Execution
executeSwap(contracts, fromAddress, amountOut, amountInMax): Promise<TxReceipt>
executeDrip(pop, password, recipient): Promise<TxReceipt>

// Error parsing
parseSwapError(error): string
parseDripError(error): string
```

## Components Structure

```
src/components/
├── App.tsx                 # Root component
├── OnboardingModal.tsx     # Onboarding flow orchestrator
├── WalletChip.tsx          # Header wallet button
├── NetworkSwitcher.tsx     # Network dropdown
├── FooterInfo.tsx          # Footer display
├── GregoSwapLogo.tsx       # Logo
├── swap/
│   ├── SwapContainer.tsx   # Main swap interface
│   ├── SwapBox.tsx         # Token input with balance
│   ├── SwapButton.tsx      # Execute button
│   ├── ExchangeRateDisplay.tsx
│   ├── SwapProgress.tsx    # Transaction progress
│   └── SwapErrorAlert.tsx  # Error display
└── onboarding/
    ├── OnboardingProgress.tsx  # Progress indicator
    ├── WalletDiscovery.tsx     # Scanning for wallets
    ├── WalletSelection.tsx     # Wallet list
    ├── EmojiVerification.tsx   # Secure channel verification
    ├── EmojiGrid.tsx           # Emoji selection grid
    ├── AccountSelection.tsx    # Account list
    ├── ConnectingWallet.tsx    # Connection status
    ├── DripPasswordInput.tsx   # PoP password form
    ├── FlowMessages.tsx        # Status messages
    └── CompletionTransition.tsx # Success animation
```

## Types (src/types/index.ts)

```typescript
interface NetworkConfig {
  id: string;
  name: string;
  nodeUrl: string;
  chainId: string;
  rollupVersion: string;
  contracts: {
    gregoCoin: string;
    gregoCoinPremium: string;
    amm: string;
    liquidityToken: string;
    pop: string;
    salt: string;
  };
  deployer: { address: string };
  deployedAt: string;
}

interface Balances {
  gregoCoin: bigint | null;
  gregoCoinPremium: bigint | null;
}

const GREGOCOIN_USD_PRICE = 10;
const EXCHANGE_RATE_POLL_INTERVAL_MS = 10000;
```

## Key Data Flows

### Initial Load

```
App mounts
  → NetworkProvider loads deployed-addresses.json
  → WalletProvider creates embedded wallet + node
  → ContractsProvider registers base contracts (embedded wallet)
  → OnboardingProvider ready for external wallet flow
```

### External Wallet Onboarding

```
User clicks "Connect Wallet"
  → startOnboarding() → status='connecting'
  → OnboardingModal discovers wallets
  → User selects wallet → initiateConnection()
  → User verifies emojis → confirmConnection()
  → OnboardingContext detects wallet → registerBaseContracts()
  → simulateOnboardingQueries() → check balance
  → IF balance=0: registerDripContracts() → await password → drip()
  → ELSE: complete onboarding
```

### Token Swap

```
User enters fromAmount
  → setFromAmount() calculates toAmount
  → User clicks "Swap"
  → executeSwap() sends transaction
  → phase: sending → mining → success
  → SwapContainer refetches balances
```

## Smart Contracts

Located in `contracts/`:

1. **GregoCoin & GregoCoinPremium** (TokenContract)
   - Standard Aztec token contracts

2. **AMM** (AMMContract)
   - `swap_tokens_for_exact_tokens()` method

3. **ProofOfPassword** (ProofOfPasswordContract)
   - `check_password_and_mint()` method
   - Uses SponsoredFPC for fee payment

## Build Configuration

### vite.config.ts

- **Node polyfills:** buffer, path for browser
- **WASM headers:** Cross-Origin-Opener-Policy, Cross-Origin-Embedder-Policy
- **Chunk size limits:** Main bundle < 1500KB, others < 8000KB

### Scripts (package.json)

```bash
yarn serve           # Dev server
yarn build           # Production build
yarn compile:contracts  # Compile Noir contracts
yarn deploy:local    # Deploy to local sandbox
yarn deploy:devnet   # Deploy to devnet
yarn test            # Run contract tests
```

### Local Development

```bash
# Terminal 1: Start Aztec sandbox
aztec start --local-network

# Terminal 2: Deploy contracts
PASSWORD=test123 yarn deploy:local

# Terminal 3: Run dev server
yarn serve
```

## Theme (src/theme.ts)

**Color palette:**

- Primary: Chartreuse green (#D4FF28) - Aztec branded
- Secondary: Deep purple (#80336A)
- Background: Pure black (#000000)
- Text: Light parchment (#F2EEE1)

**Typography:** Geist font family

## Important Patterns

### Effect-Driven State Machine (OnboardingContext)

Effects check preconditions and advance state automatically:

```typescript
// When wallet connects, mark registered and advance
useEffect(() => {
  if (status === 'connecting' && wallet && currentAddress) {
    actions.markRegistered();
    actions.advanceStatus('registering');
  }
}, [status, wallet, currentAddress]);
```

### Lazy Contract Registration

- Embedded wallet: Auto-register on mount
- External wallet: Register during onboarding
- Two stages: Base (swap) then Drip (PoP) if needed

### BigDecimal Precision (src/utils/bigDecimal.ts)

Used for exchange rate calculations with 18 decimal precision.

## Common Pitfalls

1. **Don't use re-exports** - Import directly from specific files

   ```typescript
   // WRONG
   import { useWallet } from '../contexts';

   // RIGHT
   import { useWallet } from '../contexts/wallet';
   ```

2. **Keep reducer actions namespaced** - e.g., `'swap/SET_RATE'`

3. **Effect dependencies** - OnboardingContext effects must include all dependencies to avoid stale closures

4. **Balance checks** - Embedded wallet can't query private balances; only external wallets show balances

5. **Network switching** - Requires wallet disconnect and state reset

## File Reference

### Critical Files

- `src/main.tsx` - Provider hierarchy
- `src/contexts/*/reducer.ts` - State machines
- `src/contexts/*/Context.tsx` - Context providers with effects
- `src/services/*.ts` - Business logic (pure functions)
- `src/components/OnboardingModal.tsx` - Onboarding orchestration
- `src/components/swap/SwapContainer.tsx` - Swap UI logic

### Configuration

- `vite.config.ts` - Build configuration
- `tsconfig.json` - TypeScript config
- `package.json` - Dependencies and scripts
- `src/config/networks/` - Network config loader

## Version Information

- **Aztec SDK:** v4.0.0-nightly.20260128
- **React:** 18.3.1
- **Vite:** 7.1.4
- **Node.js:** v22+
- **Yarn:** 4.5.2
