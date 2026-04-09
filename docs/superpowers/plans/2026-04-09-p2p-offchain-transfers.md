# P2P Offchain Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P2P private token transfers to GregoSwap using Aztec's offchain delivery, with shareable claim links and QR codes.

**Architecture:** Fork the standard Token contract to add a `transfer_offchain` method that delivers notes via `MessageDelivery.OFFCHAIN`. The frontend extracts offchain messages from the transaction, encodes them into URLs, and provides a claim page where recipients open the link and call `offchain_receive()` to claim tokens.

**Tech Stack:** Noir (Aztec contracts), React 18, TypeScript, MUI, Vite, qrcode.react

**Spec:** `docs/superpowers/specs/2026-04-09-p2p-offchain-transfers-design.md`

---

## File Structure

```
contracts/
  token/                              # NEW — fork of standard Token contract
    src/main.nr                       # standard Token + transfer_offchain
    Nargo.toml                        # local deps pointing to aztec-packages
  amm/Nargo.toml                      # MOD — token dep → local fork
  proof_of_password/Nargo.toml        # MOD — token dep → local fork

src/
  services/
    offchainLinkService.ts            # NEW — encode/decode transfer links
    sentHistoryService.ts             # NEW — localStorage CRUD for sent transfers
    contractService.ts                # MOD — add executeTransferOffchain + parseSendError
  contexts/
    send/
      reducer.ts                      # NEW — send state machine
      SendContext.tsx                  # NEW — send flow orchestration
      index.ts                        # NEW — exports
  components/
    App.tsx                           # MOD — hash route detection, tab bar
    send/
      SendContainer.tsx               # NEW — send flow orchestrator
      SendForm.tsx                    # NEW — token selector, address, amount
      SendProgress.tsx                # NEW — sending state indicator
      LinkDisplay.tsx                 # NEW — copyable link + QR code
      SentHistory.tsx                 # NEW — list of past transfers
    claim/
      ClaimPage.tsx                   # NEW — claim flow orchestrator
      ClaimProgress.tsx               # NEW — claiming state indicator
      ClaimSuccess.tsx                # NEW — success state + CTA
  main.tsx                            # MOD — add SendProvider
```

---

### Task 1: Fork Token Contract

**Files:**
- Create: `contracts/token/Nargo.toml`
- Create: `contracts/token/src/main.nr`
- Modify: `contracts/amm/Nargo.toml`
- Modify: `contracts/proof_of_password/Nargo.toml`

- [ ] **Step 1: Create Nargo.toml for the forked token**

Create `contracts/token/Nargo.toml`:

```toml
[package]
name = "token_contract"
authors = [""]
type = "contract"

[dependencies]
aztec = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "v4.2.0-aztecnr-rc.2", directory = "noir-projects/aztec-nr/aztec" }
uint_note = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "v4.2.0-aztecnr-rc.2", directory = "noir-projects/aztec-nr/uint-note" }
compressed_string = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "v4.2.0-aztecnr-rc.2", directory = "noir-projects/aztec-nr/compressed-string" }
balance_set = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "v4.2.0-aztecnr-rc.2", directory = "noir-projects/aztec-nr/balance-set" }
```

- [ ] **Step 2: Copy the standard Token contract source**

Copy the Token contract main.nr from the Aztec monorepo:

```bash
cp /mnt/user-data/martin/aztec-packages/noir-projects/noir-contracts/contracts/app/token_contract/src/main.nr contracts/token/src/main.nr
```

Do NOT copy the test files — we don't need them for the fork.

- [ ] **Step 3: Add the `transfer_offchain` method**

In `contracts/token/src/main.nr`, add the following method directly after the existing `transfer` function (after line ~254 in the original). The method is identical to `transfer` but uses `MessageDelivery.OFFCHAIN` for all three deliveries:

```noir
    #[external("private")]
    fn transfer_offchain(to: AztecAddress, amount: u128) {
        let from = self.msg_sender();

        let change = self.internal.subtract_balance(from, amount, INITIAL_TRANSFER_CALL_MAX_NOTES);
        self.storage.balances.at(from).add(change).deliver(MessageDelivery.OFFCHAIN);
        self.storage.balances.at(to).add(amount).deliver(MessageDelivery.OFFCHAIN);

        self.emit(Transfer { from, to, amount }).deliver_to(
            to,
            MessageDelivery.OFFCHAIN,
        );
    }
```

Note: `MessageDelivery` is already imported at line 27 of the standard Token contract (`messages::message_delivery::MessageDelivery`). No new imports needed.

- [ ] **Step 4: Remove the test module reference**

The copied `main.nr` starts with `mod test;` on line 3. Remove this line since we didn't copy the test files. Alternatively, create an empty `contracts/token/src/test.nr` with just `// Tests omitted in fork`.

- [ ] **Step 5: Update AMM Nargo.toml to use local fork**

In `contracts/amm/Nargo.toml`, change the token dependency from:

```toml
token = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "v4.2.0-aztecnr-rc.2", directory = "noir-projects/noir-contracts/contracts/app/token_contract" }
```

to:

```toml
token = { path = "../token" }
```

- [ ] **Step 6: Update PoP Nargo.toml to use local fork**

In `contracts/proof_of_password/Nargo.toml`, change the token dependency from:

```toml
token = { git = "https://github.com/AztecProtocol/aztec-packages/", tag = "v4.2.0-aztecnr-rc.2", directory = "noir-projects/noir-contracts/contracts/app/token_contract" }
```

to:

```toml
token = { path = "../token" }
```

- [ ] **Step 7: Compile contracts**

```bash
yarn compile:contracts
```

Expected: All three contracts compile successfully. The AMM and PoP contracts should work identically since the fork is additive-only.

- [ ] **Step 8: Commit**

```bash
git add contracts/token/ contracts/amm/Nargo.toml contracts/proof_of_password/Nargo.toml
git commit -m "feat: fork Token contract with transfer_offchain method

Add local fork of standard Token contract that adds a transfer_offchain
method using MessageDelivery.OFFCHAIN for all note and event deliveries.
Update AMM and PoP contracts to use local fork."
```

---

### Task 2: Offchain Link Service

**Files:**
- Create: `src/services/offchainLinkService.ts`

- [ ] **Step 1: Create the link service**

Create `src/services/offchainLinkService.ts`:

```typescript
/**
 * Offchain Link Service
 * Encodes/decodes offchain transfer messages into shareable URLs
 */

export interface TransferLink {
  token: 'gc' | 'gcp';
  amount: string;
  recipient: string;
  contractAddress: string;
  txHash: string;
  anchorBlockTimestamp: string;
  payload: string[];
}

export function encodeTransferLink(data: TransferLink): string {
  const json = JSON.stringify(data);
  const encoded = btoa(json)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${window.location.origin}/#/claim/${encoded}`;
}

export function decodeTransferLink(encoded: string): TransferLink {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(base64);
  return JSON.parse(json) as TransferLink;
}

export function extractClaimPayload(): TransferLink | null {
  const hash = window.location.hash;
  const prefix = '#/claim/';
  if (!hash.startsWith(prefix)) {
    return null;
  }
  try {
    return decodeTransferLink(hash.slice(prefix.length));
  } catch {
    return null;
  }
}

export function isClaimRoute(): boolean {
  return window.location.hash.startsWith('#/claim/');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/offchainLinkService.ts
git commit -m "feat: add offchain link service for encoding/decoding transfer URLs"
```

---

### Task 3: Sent History Service

**Files:**
- Create: `src/services/sentHistoryService.ts`

- [ ] **Step 1: Create the sent history service**

Create `src/services/sentHistoryService.ts`:

```typescript
/**
 * Sent History Service
 * localStorage CRUD for tracking sent offchain transfers
 */

export type SentTransferStatus = 'pending' | 'confirmed' | 'expired';

export interface SentTransfer {
  id: string;
  token: 'gc' | 'gcp';
  amount: string;
  recipient: string;
  link: string;
  createdAt: number;
  status: SentTransferStatus;
}

function storageKey(senderAddress: string): string {
  return `gregoswap_sent_transfers_${senderAddress}`;
}

export function getSentTransfers(senderAddress: string): SentTransfer[] {
  try {
    const raw = localStorage.getItem(storageKey(senderAddress));
    if (!raw) return [];
    return JSON.parse(raw) as SentTransfer[];
  } catch {
    return [];
  }
}

export function addSentTransfer(senderAddress: string, transfer: SentTransfer): void {
  const existing = getSentTransfers(senderAddress);
  existing.unshift(transfer);
  localStorage.setItem(storageKey(senderAddress), JSON.stringify(existing));
}

export function updateSentTransferStatus(
  senderAddress: string,
  transferId: string,
  status: SentTransferStatus,
): void {
  const transfers = getSentTransfers(senderAddress);
  const index = transfers.findIndex(t => t.id === transferId);
  if (index !== -1) {
    transfers[index].status = status;
    localStorage.setItem(storageKey(senderAddress), JSON.stringify(transfers));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/sentHistoryService.ts
git commit -m "feat: add sent history service for tracking offchain transfers"
```

---

### Task 4: Send Reducer and Context

**Files:**
- Create: `src/contexts/send/reducer.ts`
- Create: `src/contexts/send/SendContext.tsx`
- Create: `src/contexts/send/index.ts`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create the send reducer**

Create `src/contexts/send/reducer.ts` following the existing pattern from `src/contexts/swap/reducer.ts`:

```typescript
/**
 * Send Reducer
 * Manages send flow state and transaction phases
 */

import { createReducerHook, type ActionsFrom } from '../utils';

// =============================================================================
// State
// =============================================================================

export type SendPhase = 'idle' | 'sending' | 'generating_link' | 'link_ready' | 'error';

export interface SendState {
  token: 'gc' | 'gcp';
  recipientAddress: string;
  amount: string;
  phase: SendPhase;
  error: string | null;
  generatedLink: string | null;
}

export const initialSendState: SendState = {
  token: 'gc',
  recipientAddress: '',
  amount: '',
  phase: 'idle',
  error: null,
  generatedLink: null,
};

// =============================================================================
// Actions
// =============================================================================

export const sendActions = {
  setToken: (token: 'gc' | 'gcp') => ({ type: 'send/SET_TOKEN' as const, token }),
  setRecipientAddress: (address: string) => ({ type: 'send/SET_RECIPIENT' as const, address }),
  setAmount: (amount: string) => ({ type: 'send/SET_AMOUNT' as const, amount }),
  startSend: () => ({ type: 'send/START_SEND' as const }),
  generatingLink: () => ({ type: 'send/GENERATING_LINK' as const }),
  linkReady: (link: string) => ({ type: 'send/LINK_READY' as const, link }),
  sendError: (error: string) => ({ type: 'send/SEND_ERROR' as const, error }),
  dismissError: () => ({ type: 'send/DISMISS_ERROR' as const }),
  reset: () => ({ type: 'send/RESET' as const }),
};

export type SendAction = ActionsFrom<typeof sendActions>;

// =============================================================================
// Reducer
// =============================================================================

export function sendReducer(state: SendState, action: SendAction): SendState {
  switch (action.type) {
    case 'send/SET_TOKEN':
      return { ...state, token: action.token };

    case 'send/SET_RECIPIENT':
      return { ...state, recipientAddress: action.address };

    case 'send/SET_AMOUNT':
      return { ...state, amount: action.amount };

    case 'send/START_SEND':
      return { ...state, phase: 'sending', error: null, generatedLink: null };

    case 'send/GENERATING_LINK':
      return { ...state, phase: 'generating_link' };

    case 'send/LINK_READY':
      return { ...state, phase: 'link_ready', generatedLink: action.link };

    case 'send/SEND_ERROR':
      return { ...state, phase: 'error', error: action.error };

    case 'send/DISMISS_ERROR':
      return { ...state, phase: 'idle', error: null };

    case 'send/RESET':
      return { ...initialSendState };

    default:
      return state;
  }
}

// =============================================================================
// Hook
// =============================================================================

export const useSendReducer = createReducerHook(sendReducer, sendActions, initialSendState);
```

- [ ] **Step 2: Create the send context**

Create `src/contexts/send/SendContext.tsx`:

```typescript
/**
 * Send Context
 * Manages offchain transfer flow and link generation
 */

import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { useContracts } from '../contracts';
import { useWallet } from '../wallet';
import { useNetwork } from '../network';
import { useSendReducer, type SendState } from './reducer';
import { encodeTransferLink, type TransferLink } from '../../services/offchainLinkService';
import { addSentTransfer } from '../../services/sentHistoryService';
import { executeTransferOffchain } from '../../services/contractService';

interface SendContextType extends SendState {
  canSend: boolean;
  setToken: (token: 'gc' | 'gcp') => void;
  setRecipientAddress: (address: string) => void;
  setAmount: (amount: string) => void;
  executeSend: () => Promise<void>;
  dismissError: () => void;
  reset: () => void;
}

const SendContext = createContext<SendContextType | undefined>(undefined);

export function useSend() {
  const context = useContext(SendContext);
  if (context === undefined) {
    throw new Error('useSend must be used within a SendProvider');
  }
  return context;
}

interface SendProviderProps {
  children: ReactNode;
}

export function SendProvider({ children }: SendProviderProps) {
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { isLoadingContracts } = useContracts();
  const { activeNetwork } = useNetwork();
  const [state, actions] = useSendReducer();

  const canSend =
    !!state.amount &&
    parseFloat(state.amount) > 0 &&
    !!state.recipientAddress &&
    !isLoadingContracts &&
    !isUsingEmbeddedWallet &&
    !!currentAddress;

  const executeSend = useCallback(async () => {
    if (!currentAddress || !state.recipientAddress || !state.amount) {
      actions.sendError('Missing required fields');
      return;
    }

    actions.startSend();

    try {
      const recipient = AztecAddress.fromString(state.recipientAddress);
      const amount = BigInt(Math.round(parseFloat(state.amount)));

      const tokenKey = state.token === 'gc' ? 'gregoCoin' : 'gregoCoinPremium';
      const contractAddress = activeNetwork.contracts[tokenKey];

      const { receipt, offchainMessages } = await executeTransferOffchain(
        tokenKey,
        currentAddress,
        recipient,
        amount,
      );

      actions.generatingLink();

      // Encode the first recipient message into a link
      const recipientMessage = offchainMessages[0];
      if (!recipientMessage) {
        throw new Error('No offchain message generated for recipient');
      }

      const linkData: TransferLink = {
        token: state.token,
        amount: state.amount,
        recipient: state.recipientAddress,
        contractAddress,
        txHash: receipt.txHash.toString(),
        anchorBlockTimestamp: recipientMessage.anchorBlockTimestamp.toString(),
        payload: recipientMessage.payload.map((f: { toString: () => string }) => f.toString()),
      };

      const link = encodeTransferLink(linkData);
      actions.linkReady(link);

      // Save to history
      addSentTransfer(currentAddress.toString(), {
        id: receipt.txHash.toString(),
        token: state.token,
        amount: state.amount,
        recipient: state.recipientAddress,
        link,
        createdAt: Date.now(),
        status: 'confirmed',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Send failed. Please try again.';
      actions.sendError(message);
    }
  }, [currentAddress, state.recipientAddress, state.amount, state.token, activeNetwork, actions]);

  const value: SendContextType = {
    ...state,
    canSend,
    setToken: actions.setToken,
    setRecipientAddress: actions.setRecipientAddress,
    setAmount: actions.setAmount,
    executeSend,
    dismissError: actions.dismissError,
    reset: actions.reset,
  };

  return <SendContext.Provider value={value}>{children}</SendContext.Provider>;
}
```

Note: The `executeTransferOffchain` function referenced above will be added to `contractService.ts` in Task 5.

- [ ] **Step 3: Create index exports**

Create `src/contexts/send/index.ts`:

```typescript
export { SendProvider, useSend } from './SendContext';
export type { SendPhase, SendState } from './reducer';
```

- [ ] **Step 4: Add SendProvider to main.tsx**

In `src/main.tsx`, add the import and wrap `<App />` with `SendProvider` as a sibling to `SwapProvider`:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { NetworkProvider } from './contexts/network/NetworkContext';
import { WalletProvider } from './contexts/wallet/WalletContext';
import { ContractsProvider } from './contexts/contracts/ContractsContext';
import { SwapProvider } from './contexts/swap/SwapContext';
import { SendProvider } from './contexts/send/SendContext';
import { OnboardingProvider } from './contexts/onboarding/OnboardingContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NetworkProvider>
      <WalletProvider>
        <ContractsProvider>
          <OnboardingProvider>
            <SwapProvider>
              <SendProvider>
                <App />
              </SendProvider>
            </SwapProvider>
          </OnboardingProvider>
        </ContractsProvider>
      </WalletProvider>
    </NetworkProvider>
  </StrictMode>,
);
```

- [ ] **Step 5: Commit**

```bash
git add src/contexts/send/ src/main.tsx
git commit -m "feat: add Send context with reducer, provider, and state machine"
```

---

### Task 5: Contract Service — executeTransferOffchain

**Files:**
- Modify: `src/services/contractService.ts`

This task adds the `executeTransferOffchain` function to the existing contract service. It needs to:
1. Call `transfer_offchain` on the token contract
2. Self-deliver the sender's change note via `offchain_receive`
3. Return the recipient's offchain messages for link encoding

- [ ] **Step 1: Add the import for OffchainMessage**

At the top of `src/services/contractService.ts`, add the import for the offchain message type. Check the exact import path from:
- `@aztec/aztec.js/contracts` exports `extractOffchainOutput`
- The `OffchainMessage` type comes from `@aztec/aztec.js/contracts` or `@aztec/aztec.js`

Add alongside existing imports:

```typescript
import type { OffchainMessage } from '@aztec/aztec.js/contracts';
```

- [ ] **Step 2: Add executeTransferOffchain function**

Add this function to `src/services/contractService.ts` after the existing `executeDrip` function:

```typescript
/**
 * Execute an offchain token transfer.
 * Sends tokens privately with offchain note delivery, self-delivers the sender's
 * change note, and returns the recipient's offchain messages for link encoding.
 */
export async function executeTransferOffchain(
  tokenKey: 'gregoCoin' | 'gregoCoinPremium',
  fromAddress: AztecAddress,
  recipient: AztecAddress,
  amount: bigint,
  contracts: SwapContracts,
): Promise<{ receipt: TxReceipt; offchainMessages: OffchainMessage[] }> {
  const token = tokenKey === 'gregoCoin' ? contracts.gregoCoin : contracts.gregoCoinPremium;

  // 1. Send the offchain transfer transaction
  const { receipt, offchainMessages } = await token.methods
    .transfer_offchain(recipient, amount)
    .send({ from: fromAddress });

  // 2. Self-deliver sender's change note (manual until F-324 lands)
  const senderMessages = offchainMessages.filter(
    (msg: OffchainMessage) => msg.recipient.equals(fromAddress),
  );
  if (senderMessages.length > 0) {
    await token.methods
      .offchain_receive(
        senderMessages.map((msg: OffchainMessage) => ({
          ciphertext: msg.payload,
          recipient: fromAddress,
          tx_hash: receipt.txHash.hash,
          anchor_block_timestamp: msg.anchorBlockTimestamp,
        })),
      )
      .simulate({ from: fromAddress });
  }

  // 3. Filter and return recipient's messages for link encoding
  const recipientMessages = offchainMessages.filter(
    (msg: OffchainMessage) => msg.recipient.equals(recipient),
  );

  return { receipt, offchainMessages: recipientMessages };
}
```

Note: The exact types for `offchainMessages` returned by `.send()` and the shape of the `offchain_receive` argument may need adjustment during implementation based on the SDK version. Check the `TxSendResultMined` type and `offchain_receive` ABI in the compiled contract artifacts.

- [ ] **Step 3: Add parseSendError function**

Add this after the existing `parseDripError` function:

```typescript
export function parseSendError(error: unknown): string {
  if (!(error instanceof Error)) return 'Send failed. Please try again.';
  const msg = error.message;
  if (msg.includes('Balance too low')) return 'Insufficient token balance';
  if (msg.includes('User denied') || msg.includes('rejected')) return 'Transaction was rejected in wallet';
  if (msg.includes('invalid') && msg.includes('address')) return 'Invalid recipient address';
  return msg;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/contractService.ts
git commit -m "feat: add executeTransferOffchain to contract service

Handles offchain transfer execution, sender change note self-delivery,
and recipient message extraction for link encoding."
```

---

### Task 6: Install QR Code Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install qrcode.react**

```bash
yarn add qrcode.react
```

- [ ] **Step 2: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: add qrcode.react dependency for transfer link QR codes"
```

---

### Task 7: Send UI Components

**Files:**
- Create: `src/components/send/SendForm.tsx`
- Create: `src/components/send/SendProgress.tsx`
- Create: `src/components/send/LinkDisplay.tsx`
- Create: `src/components/send/SentHistory.tsx`
- Create: `src/components/send/SendContainer.tsx`

- [ ] **Step 1: Create SendForm**

Create `src/components/send/SendForm.tsx`:

```tsx
import { Box, TextField, Typography, ToggleButton, ToggleButtonGroup, Button } from '@mui/material';
import { useSend } from '../../contexts/send';

interface SendFormProps {
  balance: { gc: bigint | null; gcp: bigint | null };
}

export function SendForm({ balance }: SendFormProps) {
  const { token, recipientAddress, amount, canSend, setToken, setRecipientAddress, setAmount, executeSend, phase } =
    useSend();

  const isSending = phase === 'sending' || phase === 'generating_link';
  const currentBalance = token === 'gc' ? balance.gc : balance.gcp;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Token Selector */}
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Token
        </Typography>
        <ToggleButtonGroup
          value={token}
          exclusive
          onChange={(_, value) => value && setToken(value)}
          size="small"
          fullWidth
          disabled={isSending}
        >
          <ToggleButton value="gc">GregoCoin</ToggleButton>
          <ToggleButton value="gcp">GregoCoinPremium</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Recipient Address */}
      <TextField
        label="Recipient Address"
        placeholder="0x..."
        value={recipientAddress}
        onChange={e => setRecipientAddress(e.target.value)}
        fullWidth
        disabled={isSending}
        size="small"
      />

      {/* Amount */}
      <Box>
        <TextField
          label="Amount"
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          fullWidth
          disabled={isSending}
          size="small"
          slotProps={{
            input: {
              endAdornment: currentBalance !== null ? (
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  Balance: {currentBalance.toString()}
                </Typography>
              ) : null,
            },
          }}
        />
      </Box>

      {/* Send Button */}
      <Button
        variant="contained"
        fullWidth
        disabled={!canSend || isSending}
        onClick={executeSend}
        sx={{ mt: 1, fontWeight: 'bold' }}
      >
        {isSending ? 'Sending...' : 'Send & Generate Link'}
      </Button>
    </Box>
  );
}
```

- [ ] **Step 2: Create SendProgress**

Create `src/components/send/SendProgress.tsx`:

```tsx
import { Box, Typography, CircularProgress } from '@mui/material';
import type { SendPhase } from '../../contexts/send';

interface SendProgressProps {
  phase: SendPhase;
}

const phaseMessages: Record<string, string> = {
  sending: 'Sending transaction...',
  generating_link: 'Generating claim link...',
};

export function SendProgress({ phase }: SendProgressProps) {
  const message = phaseMessages[phase];
  if (!message) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2, justifyContent: 'center' }}>
      <CircularProgress size={20} color="primary" />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 3: Create LinkDisplay**

Create `src/components/send/LinkDisplay.tsx`:

```tsx
import { Box, Typography, Button, IconButton, Snackbar } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

interface LinkDisplayProps {
  link: string;
  amount: string;
  token: 'gc' | 'gcp';
  recipient: string;
  onReset: () => void;
}

export function LinkDisplay({ link, amount, token, recipient, onReset }: LinkDisplayProps) {
  const [copied, setCopied] = useState(false);
  const tokenName = token === 'gc' ? 'GregoCoin' : 'GregoCoinPremium';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <Typography variant="h5" color="primary" sx={{ fontWeight: 'bold' }}>
        Sent!
      </Typography>
      <Typography color="text.secondary">
        {amount} {tokenName} → {recipient.slice(0, 8)}...{recipient.slice(-4)}
      </Typography>

      {/* Copyable Link */}
      <Box
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1,
          bgcolor: 'rgba(0,0,0,0.3)',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <Typography
          variant="body2"
          sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'text.secondary' }}
        >
          {link}
        </Typography>
        <IconButton onClick={handleCopy} size="small" color="primary">
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* QR Code */}
      <Box sx={{ p: 2, bgcolor: '#fff', borderRadius: 2 }}>
        <QRCodeSVG value={link} size={160} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        Scan to claim
      </Typography>

      <Button variant="outlined" fullWidth onClick={onReset} sx={{ mt: 1 }}>
        Send another
      </Button>

      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Link copied!"
      />
    </Box>
  );
}
```

- [ ] **Step 4: Create SentHistory**

Create `src/components/send/SentHistory.tsx`:

```tsx
import { Box, Typography, IconButton, Collapse, Snackbar, Chip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useState } from 'react';
import { getSentTransfers, type SentTransfer } from '../../services/sentHistoryService';

interface SentHistoryProps {
  senderAddress: string;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusChip({ status }: { status: SentTransfer['status'] }) {
  if (status === 'confirmed') return null;
  const color = status === 'pending' ? 'warning' : 'error';
  return <Chip label={status} size="small" color={color} variant="outlined" sx={{ fontSize: '0.7em' }} />;
}

export function SentHistory({ senderAddress }: SentHistoryProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const transfers = getSentTransfers(senderAddress);

  if (transfers.length === 0) return null;

  const visibleTransfers = expanded ? transfers : transfers.slice(0, 3);
  const hasMore = transfers.length > 3;

  const handleCopy = async (link: string) => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Sent transfers
      </Typography>
      {visibleTransfers.map(transfer => (
        <Box
          key={transfer.id}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="primary" sx={{ fontWeight: 'bold' }}>
              {transfer.amount} {transfer.token === 'gc' ? 'GC' : 'GCP'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              → {transfer.recipient.slice(0, 8)}...{transfer.recipient.slice(-4)}
            </Typography>
            <StatusChip status={transfer.status} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {timeAgo(transfer.createdAt)}
            </Typography>
            <IconButton size="small" color="primary" onClick={() => handleCopy(transfer.link)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      ))}
      {hasMore && (
        <Box sx={{ textAlign: 'center', mt: 1 }}>
          <IconButton
            size="small"
            onClick={() => setExpanded(!expanded)}
            sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
          >
            <ExpandMoreIcon />
          </IconButton>
        </Box>
      )}
      <Snackbar open={copied} autoHideDuration={2000} onClose={() => setCopied(false)} message="Link copied!" />
    </Box>
  );
}
```

- [ ] **Step 5: Create SendContainer**

Create `src/components/send/SendContainer.tsx`. This orchestrates the send flow, similar to how `SwapContainer` orchestrates swaps:

```tsx
import { Box, Alert } from '@mui/material';
import { useSend } from '../../contexts/send';
import { useWallet } from '../../contexts/wallet';
import { useContracts } from '../../contexts/contracts';
import { SendForm } from './SendForm';
import { SendProgress } from './SendProgress';
import { LinkDisplay } from './LinkDisplay';
import { SentHistory } from './SentHistory';
import { useEffect, useState } from 'react';

export function SendContainer() {
  const { phase, error, generatedLink, token, amount, recipientAddress, dismissError, reset } = useSend();
  const { currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { fetchBalances } = useContracts();
  const [balances, setBalances] = useState<{ gc: bigint | null; gcp: bigint | null }>({
    gc: null,
    gcp: null,
  });

  useEffect(() => {
    if (currentAddress && !isUsingEmbeddedWallet) {
      fetchBalances().then(([gc, gcp]) => setBalances({ gc, gcp }));
    }
  }, [currentAddress, isUsingEmbeddedWallet, fetchBalances]);

  // Refresh balances after a successful send
  useEffect(() => {
    if (phase === 'link_ready' && currentAddress) {
      fetchBalances().then(([gc, gcp]) => setBalances({ gc, gcp }));
    }
  }, [phase, currentAddress, fetchBalances]);

  if (isUsingEmbeddedWallet) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Alert severity="info">Connect an external wallet to send tokens.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {phase === 'link_ready' && generatedLink ? (
        <LinkDisplay
          link={generatedLink}
          amount={amount}
          token={token}
          recipient={recipientAddress}
          onReset={reset}
        />
      ) : (
        <>
          <SendForm balance={balances} />
          <SendProgress phase={phase} />
        </>
      )}

      {error && (
        <Alert severity="error" onClose={dismissError} sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {currentAddress && <SentHistory senderAddress={currentAddress.toString()} />}
    </Box>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/send/
git commit -m "feat: add Send UI components

SendForm (token selector, address, amount), SendProgress, LinkDisplay
(copyable link + QR code), SentHistory, and SendContainer orchestrator."
```

---

### Task 8: Claim Page Components

**Files:**
- Create: `src/components/claim/ClaimProgress.tsx`
- Create: `src/components/claim/ClaimSuccess.tsx`
- Create: `src/components/claim/ClaimPage.tsx`

- [ ] **Step 1: Create ClaimProgress**

Create `src/components/claim/ClaimProgress.tsx`:

```tsx
import { Box, Typography, CircularProgress } from '@mui/material';

type ClaimPhase = 'claiming' | 'verifying';

interface ClaimProgressProps {
  phase: ClaimPhase;
}

const phaseMessages: Record<ClaimPhase, string> = {
  claiming: 'Claiming tokens...',
  verifying: 'Verifying amount...',
};

export function ClaimProgress({ phase }: ClaimProgressProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2, justifyContent: 'center' }}>
      <CircularProgress size={20} color="primary" />
      <Typography variant="body2" color="text.secondary">
        {phaseMessages[phase]}
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 2: Create ClaimSuccess**

Create `src/components/claim/ClaimSuccess.tsx`:

```tsx
import { Box, Typography, Button, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface ClaimSuccessProps {
  amount: string;
  tokenName: string;
  verified: boolean;
  onGoToSwap: () => void;
}

export function ClaimSuccess({ amount, tokenName, verified, onGoToSwap }: ClaimSuccessProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 3 }}>
      <CheckCircleIcon sx={{ fontSize: 48, color: 'primary.main' }} />
      <Typography variant="h5" color="primary" sx={{ fontWeight: 'bold' }}>
        Tokens Claimed!
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" color="text.primary">
          {amount} {tokenName}
        </Typography>
        <Chip
          label={verified ? 'Verified' : 'Verifying...'}
          size="small"
          color={verified ? 'success' : 'default'}
          variant="outlined"
        />
      </Box>
      <Button variant="contained" onClick={onGoToSwap} sx={{ mt: 2, fontWeight: 'bold' }}>
        Start Swapping →
      </Button>
    </Box>
  );
}
```

- [ ] **Step 3: Create ClaimPage**

Create `src/components/claim/ClaimPage.tsx`. This is the main claim flow orchestrator:

```tsx
import { Box, Typography, Button, Alert, CircularProgress, Container, Chip } from '@mui/material';
import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '../../contexts/wallet';
import { useContracts } from '../../contexts/contracts';
import { extractClaimPayload, type TransferLink } from '../../services/offchainLinkService';
import { ClaimProgress } from './ClaimProgress';
import { ClaimSuccess } from './ClaimSuccess';
import { GregoSwapLogo } from '../GregoSwapLogo';

type ClaimState =
  | { phase: 'decoding' }
  | { phase: 'preview'; data: TransferLink }
  | { phase: 'claiming'; data: TransferLink }
  | { phase: 'verifying'; data: TransferLink }
  | { phase: 'claimed'; data: TransferLink; verified: boolean }
  | { phase: 'error'; message: string };

export function ClaimPage() {
  const [state, setState] = useState<ClaimState>({ phase: 'decoding' });
  const { wallet, currentAddress, isUsingEmbeddedWallet } = useWallet();
  const { fetchBalances, registerBaseContracts, isLoadingContracts } = useContracts();

  // Step 1: Decode the link on mount
  useEffect(() => {
    const data = extractClaimPayload();
    if (!data) {
      setState({ phase: 'error', message: 'Invalid or missing claim link.' });
      return;
    }
    setState({ phase: 'preview', data });
  }, []);

  // Step 2: Execute the claim
  const doClaim = useCallback(async () => {
    if (state.phase !== 'preview') return;
    const { data } = state;

    setState({ phase: 'claiming', data });

    try {
      // Ensure contracts are registered
      if (!isLoadingContracts && wallet) {
        await registerBaseContracts();
      }

      // Wait for wallet to be ready
      if (!wallet || !currentAddress) {
        // Wallet should auto-create (embedded) or already be connected
        setState({ phase: 'error', message: 'No wallet available. Please refresh and try again.' });
        return;
      }

      // Get balance before claim (for verification diff)
      let balanceBefore = 0n;
      try {
        const [gc, gcp] = await fetchBalances();
        balanceBefore = data.token === 'gc' ? gc : gcp;
      } catch {
        // New wallet might not have balance yet — that's fine
      }

      // Reconstruct Fr values from payload strings
      const { Fr } = await import('@aztec/aztec.js/fields');
      const payload = data.payload.map((s: string) => Fr.fromString(s));

      // Call offchain_receive on the token contract
      const tokenKey = data.token === 'gc' ? 'gregoCoin' : 'gregoCoinPremium';
      // Access the token contract from the contracts context
      // Note: this will need to be adapted based on how contracts are exposed
      const { AztecAddress } = await import('@aztec/aztec.js/addresses');
      const recipient = AztecAddress.fromString(data.recipient);

      // The actual offchain_receive call — this needs the token contract instance.
      // The ContractsContext will need to expose the token contracts or a claimOffchain method.
      // For now, show the pattern:
      // await tokenContract.methods.offchain_receive([{
      //   ciphertext: payload,
      //   recipient,
      //   tx_hash: data.txHash,
      //   anchor_block_timestamp: BigInt(data.anchorBlockTimestamp),
      // }]).simulate({ from: currentAddress });

      setState({ phase: 'verifying', data });

      // Verify: check balance after
      const [gcAfter, gcpAfter] = await fetchBalances();
      const balanceAfter = data.token === 'gc' ? gcAfter : gcpAfter;
      const received = balanceAfter - balanceBefore;
      const expectedAmount = BigInt(Math.round(parseFloat(data.amount)));
      const verified = received >= expectedAmount;

      setState({ phase: 'claimed', data, verified });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Claim failed. Please try again.';
      setState({ phase: 'error', message });
    }
  }, [state, wallet, currentAddress, isLoadingContracts, registerBaseContracts, fetchBalances]);

  const handleGoToSwap = () => {
    window.location.hash = '';
    window.location.reload();
  };

  const tokenName = (t: string) => (t === 'gc' ? 'GregoCoin' : 'GregoCoinPremium');

  return (
    <Container maxWidth="sm" sx={{ py: 4, position: 'relative', zIndex: 1 }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <GregoSwapLogo height={40} />
      </Box>

      <Box
        sx={{
          p: 3,
          bgcolor: 'background.paper',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {state.phase === 'decoding' && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {state.phase === 'preview' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Typography variant="h5" color="text.primary">
              Someone sent you
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h4" color="primary" sx={{ fontWeight: 'bold' }}>
                {state.data.amount} {tokenName(state.data.token)}
              </Typography>
              <Chip label="unverified" size="small" variant="outlined" />
            </Box>
            <Button
              variant="contained"
              size="large"
              onClick={doClaim}
              sx={{ mt: 2, fontWeight: 'bold', px: 6 }}
            >
              Claim
            </Button>
          </Box>
        )}

        {state.phase === 'claiming' && <ClaimProgress phase="claiming" />}
        {state.phase === 'verifying' && <ClaimProgress phase="verifying" />}

        {state.phase === 'claimed' && (
          <ClaimSuccess
            amount={state.data.amount}
            tokenName={tokenName(state.data.token)}
            verified={state.verified}
            onGoToSwap={handleGoToSwap}
          />
        )}

        {state.phase === 'error' && (
          <Alert severity="error">{state.message}</Alert>
        )}
      </Box>
    </Container>
  );
}
```

**Implementation note:** The `offchain_receive` call in `ClaimPage` is commented as a pattern because the `ContractsContext` doesn't currently expose raw token contract instances. During implementation, either:
1. Expose the token contracts from `ContractsContext` (add a `getTokenContract(tokenKey)` method), or
2. Add a `claimOffchainTransfer(tokenKey, message)` method to `ContractsContext`

Option 2 is cleaner — it follows the existing pattern where `ContractsContext` wraps contract interactions.

- [ ] **Step 4: Commit**

```bash
git add src/components/claim/
git commit -m "feat: add Claim page components

ClaimPage (orchestrator with state machine), ClaimProgress,
and ClaimSuccess. Handles link decoding, wallet resolution,
offchain_receive, and balance verification."
```

---

### Task 9: App Routing and Tab Bar

**Files:**
- Modify: `src/components/App.tsx`

- [ ] **Step 1: Add route detection and tab bar to App.tsx**

Update `src/components/App.tsx` to:
1. Detect `/#/claim/` routes and render `ClaimPage` instead of the main UI
2. Add a Swap/Send tab bar

Replace the entire file with:

```tsx
import { ThemeProvider, CssBaseline, Container, Box, Typography, Tabs, Tab } from '@mui/material';
import { theme } from './theme';
import { GregoSwapLogo } from './components/GregoSwapLogo';
import { WalletChip } from './components/WalletChip';
import { NetworkSwitcher } from './components/NetworkSwitcher';
import { FooterInfo } from './components/FooterInfo';
import { SwapContainer } from './components/swap';
import { SendContainer } from './components/send/SendContainer';
import { ClaimPage } from './components/claim/ClaimPage';
import { useWallet } from './contexts/wallet';
import { useOnboarding } from './contexts/onboarding';
import { OnboardingModal } from './components/OnboardingModal';
import { TxNotificationCenter } from './components/TxNotificationCenter';
import { isClaimRoute } from './services/offchainLinkService';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { useState } from 'react';

export function App() {
  const { disconnectWallet, setCurrentAddress, currentAddress, error: walletError, isLoading: walletLoading } =
    useWallet();
  const { isOnboardingModalOpen, startOnboarding, resetOnboarding, status: onboardingStatus } = useOnboarding();
  const [activeTab, setActiveTab] = useState(0);

  const isOnboarded = onboardingStatus === 'completed';

  // If on a claim route, render the claim page directly
  if (isClaimRoute()) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            minHeight: '100vh',
            backgroundColor: 'background.default',
            py: 4,
            position: 'relative',
            overflow: 'hidden',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundImage: 'url(/background.jpg)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              filter: 'grayscale(60%) brightness(0.5) contrast(0.8) saturate(0.8)',
              opacity: 0.6,
              zIndex: 0,
            },
          }}
        >
          <ClaimPage />
        </Box>
      </ThemeProvider>
    );
  }

  const handleWalletClick = () => {
    if (isOnboarded && currentAddress) {
      resetOnboarding();
    }
    startOnboarding();
  };

  const handleDisconnect = async () => {
    await disconnectWallet();
    resetOnboarding();
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: '100vh',
          backgroundColor: 'background.default',
          py: 4,
          position: 'relative',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: 'url(/background.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'grayscale(60%) brightness(0.5) contrast(0.8) saturate(0.8)',
            opacity: 0.6,
            zIndex: 0,
          },
        }}
      >
        <NetworkSwitcher />

        <WalletChip
          address={currentAddress?.toString() || null}
          isConnected={isOnboarded && currentAddress !== null}
          onClick={handleWalletClick}
          onDisconnect={handleDisconnect}
        />

        <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ textAlign: 'center', mb: 4, mt: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <GregoSwapLogo height={56} />
            </Box>
            <Typography variant="body1" color="text.secondary">
              Swap GregoCoin for GregoCoinPremium
            </Typography>
          </Box>

          {/* Tab Bar */}
          <Tabs
            value={activeTab}
            onChange={(_, value) => setActiveTab(value)}
            centered
            sx={{
              mb: 3,
              '& .MuiTab-root': { color: 'text.secondary', fontWeight: 600 },
              '& .Mui-selected': { color: 'primary.main' },
              '& .MuiTabs-indicator': { backgroundColor: 'primary.main' },
            }}
          >
            <Tab label="Swap" />
            <Tab label="Send" />
          </Tabs>

          {/* Tab Content */}
          {activeTab === 0 && <SwapContainer />}
          {activeTab === 1 && <SendContainer />}

          {walletError && (
            <Box sx={{ mt: 3 }}>
              <Box
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(211, 47, 47, 0.1)',
                  border: '1px solid rgba(211, 47, 47, 0.3)',
                  borderRadius: 1,
                }}
              >
                <Typography variant="h6" color="error" sx={{ mb: 1, fontWeight: 600 }}>
                  Wallet Connection Error
                </Typography>
                <Typography variant="body2" color="error" sx={{ whiteSpace: 'pre-line' }}>
                  {walletError}
                </Typography>
              </Box>
            </Box>
          )}

          {walletLoading && !walletError && (
            <Box sx={{ mt: 3 }}>
              <Box
                sx={{
                  p: 3,
                  backgroundColor: 'rgba(212, 255, 40, 0.05)',
                  border: '1px solid rgba(212, 255, 40, 0.2)',
                  borderRadius: 1,
                  textAlign: 'center',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Connecting to network...
                </Typography>
              </Box>
            </Box>
          )}

          <FooterInfo />
        </Container>
      </Box>

      <OnboardingModal
        open={isOnboardingModalOpen}
        onAccountSelect={(address: AztecAddress) => {
          setCurrentAddress(address);
        }}
      />

      <TxNotificationCenter account={currentAddress?.toString()} />
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Verify build compiles**

```bash
yarn build
```

Expected: Build succeeds (or only type errors from the `offchain_receive` integration in ClaimPage, which will be finalized during integration testing).

- [ ] **Step 3: Commit**

```bash
git add src/components/App.tsx
git commit -m "feat: add hash routing for claim page and Swap/Send tab bar

Detects /#/claim/ routes and renders ClaimPage. Adds Swap/Send
tabs to the main interface."
```

---

### Task 10: Integration — Wire ContractsContext for Offchain Transfers

**Files:**
- Modify: `src/contexts/contracts/ContractsContext.tsx`

The `ClaimPage` and `SendContext` need to interact with token contracts for `transfer_offchain` and `offchain_receive`. The cleanest approach is to add methods to `ContractsContext`.

- [ ] **Step 1: Add sendOffchain and claimOffchainTransfer to ContractsContextType**

In `src/contexts/contracts/ContractsContext.tsx`, add to the `ContractsContextType` interface:

```typescript
  // Offchain transfer methods
  sendOffchain: (tokenKey: 'gregoCoin' | 'gregoCoinPremium', recipient: AztecAddress, amount: bigint) => Promise<{ receipt: TxReceipt; offchainMessages: any[] }>;
  claimOffchainTransfer: (tokenKey: 'gregoCoin' | 'gregoCoinPremium', message: { ciphertext: any[]; recipient: AztecAddress; tx_hash: string; anchor_block_timestamp: bigint }) => Promise<void>;
```

- [ ] **Step 2: Implement the methods in ContractsProvider**

Add the implementations inside `ContractsProvider`, following the pattern of existing methods like `swap`:

```typescript
  const sendOffchain = useCallback(async (
    tokenKey: 'gregoCoin' | 'gregoCoinPremium',
    recipient: AztecAddress,
    amount: bigint,
  ) => {
    if (!wallet || !currentAddress || !state.contracts) {
      throw new Error('Contracts not initialized');
    }
    return contractService.executeTransferOffchain(
      tokenKey,
      currentAddress,
      recipient,
      amount,
      state.contracts,
    );
  }, [wallet, currentAddress, state.contracts]);

  const claimOffchainTransfer = useCallback(async (
    tokenKey: 'gregoCoin' | 'gregoCoinPremium',
    message: { ciphertext: any[]; recipient: AztecAddress; tx_hash: string; anchor_block_timestamp: bigint },
  ) => {
    if (!wallet || !currentAddress || !state.contracts) {
      throw new Error('Contracts not initialized');
    }
    const token = tokenKey === 'gregoCoin' ? state.contracts.gregoCoin : state.contracts.gregoCoinPremium;
    await token.methods
      .offchain_receive([message])
      .simulate({ from: currentAddress });
  }, [wallet, currentAddress, state.contracts]);
```

Add both methods to the context value object.

- [ ] **Step 3: Update SendContext to use sendOffchain from ContractsContext**

In `src/contexts/send/SendContext.tsx`, replace the direct `executeTransferOffchain` call with:

```typescript
const { sendOffchain } = useContracts();

// Inside executeSend:
const { receipt, offchainMessages } = await sendOffchain(tokenKey, recipient, amount);
```

Remove the direct import of `executeTransferOffchain` from `contractService`.

- [ ] **Step 4: Update ClaimPage to use claimOffchainTransfer**

In `src/components/claim/ClaimPage.tsx`, replace the commented-out `offchain_receive` call with:

```typescript
const { claimOffchainTransfer, registerBaseContracts, fetchBalances } = useContracts();

// Inside doClaim:
const { Fr } = await import('@aztec/aztec.js/fields');
const { AztecAddress } = await import('@aztec/aztec.js/addresses');

await claimOffchainTransfer(
  data.token === 'gc' ? 'gregoCoin' : 'gregoCoinPremium',
  {
    ciphertext: data.payload.map((s: string) => Fr.fromString(s)),
    recipient: AztecAddress.fromString(data.recipient),
    tx_hash: data.txHash,
    anchor_block_timestamp: BigInt(data.anchorBlockTimestamp),
  },
);
```

- [ ] **Step 5: Commit**

```bash
git add src/contexts/contracts/ContractsContext.tsx src/contexts/send/SendContext.tsx src/components/claim/ClaimPage.tsx
git commit -m "feat: wire offchain transfer methods through ContractsContext

Add sendOffchain and claimOffchainTransfer to ContractsContext.
Update SendContext and ClaimPage to use them."
```

---

### Task 11: Deploy and End-to-End Test

**Files:** No new files — integration testing

- [ ] **Step 1: Deploy contracts to local sandbox**

```bash
# Terminal 1: Start Aztec sandbox (if not running)
aztec start --local-network

# Terminal 2: Deploy contracts with the forked token
PASSWORD=test123 yarn deploy:local
```

Expected: All contracts deploy successfully, including the forked Token contract with `transfer_offchain`.

- [ ] **Step 2: Start dev server and test the send flow**

```bash
yarn serve
```

1. Open the app, connect an external wallet, complete onboarding
2. Switch to the "Send" tab
3. Select GregoCoin, enter recipient address (use a second account), enter amount
4. Click "Send & Generate Link"
5. Verify: Transaction sends, link is generated, QR code appears
6. Copy the link

- [ ] **Step 3: Test the claim flow**

1. Open the copied link in a new browser tab/incognito window
2. Verify: Preview shows "Someone sent you X GregoCoin" with "unverified" badge
3. Click "Claim"
4. Verify: Wallet auto-creates, offchain_receive is called, balance is verified
5. Verify: Success screen with verified amount

- [ ] **Step 4: Test sent history**

1. Go back to the sender's tab, check the Send tab
2. Verify: Sent history shows the transfer with "confirmed" status
3. Click "Copy link" — verify it copies the same link

- [ ] **Step 5: Test error cases**

1. Try opening a claim link with a wallet whose address doesn't match the recipient — should show decryption error
2. Try sending with insufficient balance — should show balance error
3. Try claim with an invalid/corrupted link — should show invalid link error

- [ ] **Step 6: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: integration adjustments from end-to-end testing"
```

---

### Task 12: Redeploy Contracts (if needed)

If the compiled Token contract artifact changed (new ABI from `transfer_offchain`), the deploy script may need updating to reference the new artifact. Check:

- [ ] **Step 1: Verify contract artifacts**

```bash
ls contracts/target/
```

Check that `Token.json` (or equivalent artifact) includes the `transfer_offchain` method in its ABI.

- [ ] **Step 2: Update deploy script if needed**

Check the deploy script (`deploy:local` in package.json) to ensure it deploys the forked Token contract. Since we kept the same contract name (`token_contract`), the artifacts should be compatible.

- [ ] **Step 3: Update deployed-addresses.json if needed**

If contract addresses change after redeployment, update `src/config/networks/deployed-addresses.json` with new addresses.

- [ ] **Step 4: Commit**

```bash
git add contracts/target/ src/config/networks/
git commit -m "chore: update contract artifacts and deployed addresses for forked token"
```
