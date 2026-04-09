# P2P Private Transfers with Offchain Delivery

**Date:** 2026-04-09
**Status:** Design approved
**Goal:** Add P2P private token transfers to GregoSwap using Aztec's offchain delivery feature, with shareable claim links and QR codes as the delivery channel.

## Motivation

This feature serves as a dogfooding vehicle for Aztec's offchain delivery feature. It exercises the full vertical slice:

- **Contract DX:** Writing `.deliver(MessageDelivery.OFFCHAIN)` in a forked Token contract
- **SDK integration:** Extracting `offchainMessages` from transactions, calling `offchain_receive()`
- **Delivery channel:** Encoding offchain messages into shareable URLs and QR codes
- **End-user experience:** Sender generates a link, recipient opens it and claims tokens

Lessons learned will be retrofitted into the offchain delivery feature itself.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Delivery channel | Shareable link + QR code | Tests URL-based delivery; works for both remote sharing and in-person |
| Token note delivery | Offchain (not escrow) | Exercises the core offchain delivery path; note is created directly for recipient |
| Expiration | None (protocol-level tx expiry only) | Keeps focus on offchain delivery; escrow would bypass it |
| Transferable tokens | GregoCoin and GregoCoinPremium | Both tokens supported via token selector |
| Recipient wallet | Use existing if connected; auto-create embedded if not | Minimum friction for new users |
| Claim trigger | Explicit "Claim" button | Gives recipient time to understand what's happening before committing |
| Amount display | Show URL amount optimistically, verify after claim | Instant preview with trust-but-verify UX |
| Contract change | Local fork of Token contract | Iterate locally; upstream later if it works well |
| Transfer event | Offchain (same as notes) | Fully consistent — nothing onchain except the note hash |

## Non-Goals

- No expiration/reclaim mechanism (tokens are gone once the note is in the tree)
- No claim detection from sender's perspective (fire-and-forget by design)
- No address book or ENS-style resolution
- No "send to anyone" pattern (recipient address is required for encryption)

## Architecture

### Overview

```
Sender                          Recipient
  │                                │
  ├─ transfer_offchain(to, amt)    │
  │   ├─ subtract sender balance   │
  │   ├─ add recipient note ──── .deliver(OFFCHAIN)
  │   ├─ add sender change note ─ .deliver(OFFCHAIN)
  │   └─ emit Transfer event ──── .deliver(OFFCHAIN)
  │                                │
  ├─ SDK returns offchainMessages  │
  ├─ Self-deliver change note      │
  ├─ Encode recipient msg → URL    │
  ├─ Show link + QR code           │
  │                                │
  │ ─── share link ───────────────>│
  │                                ├─ Open link → preview amount
  │                                ├─ Click "Claim"
  │                                ├─ Connect/create wallet
  │                                ├─ offchain_receive(message)
  │                                ├─ PXE syncs → note decrypted
  │                                ├─ Verify balance
  │                                └─ Tokens available
```

### File Structure

```
contracts/
  token/                          # NEW — fork of standard Token contract
    src/main.nr                   # standard Token + transfer_offchain method
    Nargo.toml
  amm/Nargo.toml                  # MOD — point token dep to local fork
  proof_of_password/Nargo.toml    # MOD — point token dep to local fork

src/
  services/
    offchainLinkService.ts        # NEW — encode/decode transfer links
    sentHistoryService.ts         # NEW — localStorage CRUD for sent transfers
    contractService.ts            # MOD — add executeTransferOffchain
  components/
    App.tsx                       # MOD — route detection, tab bar
    send/
      SendContainer.tsx           # NEW — orchestrates send flow
      SendForm.tsx                # NEW — token selector, address, amount
      SendProgress.tsx            # NEW — sending + generating states
      LinkDisplay.tsx             # NEW — copyable link + QR code
      SentHistory.tsx             # NEW — list of sent transfers
    claim/
      ClaimPage.tsx               # NEW — orchestrates claim flow
      ClaimProgress.tsx           # NEW — state machine progress
      ClaimSuccess.tsx            # NEW — success state with CTA
    swap/
      SwapContainer.tsx           # MOD — wrap in tab structure
  contexts/
    send/
      SendContext.tsx              # NEW — send flow state management
      reducer.ts                  # NEW — send state machine
      index.ts
```

## Section 1: Smart Contract

Fork the standard Token contract into `contracts/token/`. The only addition is a `transfer_offchain` method — identical to `transfer` but with `MessageDelivery.OFFCHAIN` for all deliveries.

### New method

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

### What changes vs. standard Token

- **Add** `transfer_offchain` — new private function (~10 lines)
- **Add** `MessageDelivery` import (if not already present)
- **No changes** to `subtract_balance`, storage, other methods, or recursive balance logic

### Dependency updates

Update `Nargo.toml` in `contracts/amm/` and `contracts/proof_of_password/` to point `token` dependency to the local fork:

```toml
token = { path = "../token" }
```

## Section 2: SDK Integration & Link Encoding

### 2a. Extracting offchain messages

The SDK's `.send()` already returns `{ receipt, offchainEffects, offchainMessages }` (type `TxSendResultMined`). No extra SDK work needed.

New function in `contractService.ts`:

```typescript
async function executeTransferOffchain(
  token: TokenContract,
  fromAddress: AztecAddress,
  recipient: AztecAddress,
  amount: bigint,
): Promise<{ receipt: TxReceipt; offchainMessages: OffchainMessage[] }> {
  // 1. Send transaction — SDK extracts offchain messages automatically
  const { receipt, offchainMessages } = await token.methods
    .transfer_offchain(recipient, amount)
    .send({ from: fromAddress });

  // 2. Self-deliver sender's change note
  const senderMessages = offchainMessages
    .filter(msg => msg.recipient.equals(fromAddress));
  if (senderMessages.length > 0) {
    await token.methods
      .offchain_receive(senderMessages.map(msg => ({
        ciphertext: msg.payload,
        recipient: fromAddress,
        tx_hash: receipt.txHash.hash,
        anchor_block_timestamp: msg.anchorBlockTimestamp,
      })))
      .simulate({ from: fromAddress });
  }

  // 3. Return recipient's messages for link encoding
  const recipientMessages = offchainMessages
    .filter(msg => msg.recipient.equals(recipient));

  return { receipt, offchainMessages: recipientMessages };
}
```

### 2b. Link encoding

New file: `src/services/offchainLinkService.ts`

```typescript
interface TransferLink {
  token: 'gc' | 'gcp';            // which token
  amount: string;                  // human-readable amount (untrusted, for preview)
  recipient: string;               // intended recipient Aztec address
  contractAddress: string;         // token contract address
  txHash: string;                  // originating tx hash
  anchorBlockTimestamp: string;     // for offchain_receive
  payload: string[];               // Fr[] as hex strings (encrypted note ciphertext)
}

function encodeTransferLink(data: TransferLink): string {
  const json = JSON.stringify(data);
  const encoded = btoa(json)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${window.location.origin}/#/claim/${encoded}`;
}

function decodeTransferLink(encoded: string): TransferLink {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}
```

### 2c. URL size estimate

| Component | Size (approx) |
|-----------|---------------|
| Payload (Fr[] encrypted ciphertext) | ~20 fields x 64 hex chars = ~1,280 chars |
| Metadata (token, amount, addresses, tx hash) | ~300 chars |
| Base64 overhead (~33%) | ~520 chars |
| **Total URL length** | **~2,100 chars** |

Within limits for browsers (~8,000 chars) and QR codes (~4,296 alphanumeric chars).

## Section 3: Claim Flow (Recipient UX)

### Route

New hash route: `/#/claim/{base64url_payload}`

`App.tsx` detects this route and renders `ClaimPage` instead of the swap interface.

### State machine

```
decoding → preview → claiming → verifying → claimed
                                               ↗
                                    error (from any state)
```

| State | What happens | User sees |
|-------|-------------|-----------|
| `decoding` | Parse base64url from URL, validate structure | Brief loading flash |
| `preview` | Display transfer info from URL metadata | "Someone sent you 50 GregoCoin!" with amount and token. **"Claim" button** |
| `claiming` | User clicked Claim. Connect/create wallet, register token contract, call `offchain_receive()` | "Claiming tokens..." spinner |
| `verifying` | Query `balance_of_private()`, compare to expected amount | "Verifying amount..." indicator (amount badge updates) |
| `claimed` | Balance confirmed | Amount badge turns green, "Tokens claimed! Start swapping" CTA |
| `error` | Invalid link, network error, amount mismatch, decryption failure | Error message with description |

### Wallet resolution

```
On "Claim" button press:
├── External wallet already connected?
│   └── YES → Use it. Register token contract if needed.
│
└── No wallet connected?
    └── Auto-create embedded wallet
        → Create node client
        → Create embedded wallet
        → Register token contract
        → Claim into embedded wallet's address
```

The link's `recipient` field must match the claiming wallet's address — `offchain_receive` will fail to decrypt if they don't match. This surfaces as a clear error.

### Amount verification

The claim page shows the amount from the URL immediately (optimistic preview). After `offchain_receive` completes, it queries the balance and confirms the amount matches. The amount badge transitions from "unverified" to "verified" state.

For new users (fresh embedded wallet): balance = received amount.
For returning users: snapshot balance before claim, diff after.

### After claiming

Success screen with CTA to navigate to the main swap page. If using an auto-created embedded wallet, the user is considered onboarded — skip the normal onboarding flow.

## Section 4: Sender UX

### Navigation

Add a **Swap / Send** tab bar above the current swap interface. Both tabs share the same container width and visual style. The Send tab is only enabled when the user has a connected external wallet with a balance.

### Send form

- **Token toggle:** GregoCoin / GregoCoinPremium (two buttons, not a dropdown)
- **Recipient address:** Text input accepting a full Aztec address (hex string)
- **Amount:** Number input with balance display
- **Button:** "Send & Generate Link"

### Send flow state machine

```
idle → sending → generating_link → link_ready
```

| State | What happens |
|-------|-------------|
| `idle` | Form visible, user fills in token + recipient + amount |
| `sending` | Call `transfer_offchain()`, wait for tx receipt + offchain messages |
| `generating_link` | Self-deliver change note, filter recipient messages, encode URL, generate QR |
| `link_ready` | Show copyable link + QR code, save to sent history |

### Link display

After generation:
- Copyable link field with copy button
- QR code (using `qrcode.react` or similar lightweight library — new dependency)
- "Send another" button to reset the form

## Section 5: Sent History

### Location

Below the Send form, visible only on the Send tab. Collapsed by default if more than 3 entries.

### Data model

```typescript
interface SentTransfer {
  id: string;                // tx hash
  token: 'gc' | 'gcp';
  amount: string;
  recipient: string;         // Aztec address
  link: string;              // full claim URL
  createdAt: number;         // timestamp
  status: 'pending' | 'confirmed' | 'expired';
}
```

Stored in localStorage keyed by sender address: `gregoswap_sent_transfers_{senderAddress}`

### Status tracking

Aztec transactions have a protocol-level 24-hour mining window. The tx hash is derived from the expiration timestamp, so we can determine the deadline without extra queries.

| Status | Meaning |
|--------|---------|
| `pending` | Tx sent but not yet confirmed as mined |
| `confirmed` | Tx mined, note exists in the tree, link is valid and claimable |
| `expired` | 24h passed without the tx being mined (reorg, network issues, etc.) — tokens were never sent |

The happy path is always `pending → confirmed` (typically within seconds/minutes). The `expired` state is an edge case (reorgs, sequencer issues) but important for informing the user that their tokens weren't actually sent.

**Status resolution:** When the Send tab loads, pending transfers are checked by querying the node for the tx receipt (using the stored tx hash). If the tx is mined, status updates to `confirmed`. If the current time exceeds the 24h deadline derived from the tx hash, status updates to `expired`.

**Claim detection is not possible** with the direct transfer approach. Once the tx is mined, the sender has no on-chain way to know if the recipient called `offchain_receive`. The history serves as a "links I've generated" log with re-share capability, not a live status tracker.

### List UI

Each row shows:
- Token amount and type (e.g., "50 GC")
- Truncated recipient address
- Relative timestamp
- Status indicator (for pending/expired states)
- "Copy link" button for re-sharing

## New Dependencies

- `qrcode.react` (or similar) — QR code generation for claim links

## Dogfooding Observations (Captured During Design)

These are insights surfaced during the design process, worth feeding back into the offchain delivery feature:

1. **Partial notes don't support offchain delivery.** The `partial_note.complete()` flow hardcodes `ONCHAIN_UNCONSTRAINED`. This means most DeFi contracts (AMMs, lending) that use partial notes can't adopt offchain delivery without foundational changes. Offchain delivery currently only works with direct note creation.

2. **Standard Token contract hardcodes delivery mode.** `transfer()` uses `ONCHAIN_UNCONSTRAINED` with no way to choose offchain delivery from the outside. Every contract wanting to offer offchain delivery must add a separate method (or delivery mode should become a parameter on standard methods).

3. **"Duplicate method, swap delivery mode" pattern.** `transfer_offchain` is identical to `transfer` except for the delivery mode constant. This suggests delivery mode could be a parameter rather than requiring method duplication.

4. **Self-delivery is manual friction (F-324).** The sender must explicitly call `offchain_receive` for their own change note. This is boilerplate every app must handle. Automatic self-delivery would eliminate this.

5. **Sender has no feedback channel.** With direct offchain delivery (no escrow), the sender cannot know if the recipient received or processed the offchain message. This is inherent to the "fire and forget" model but worth documenting as a tradeoff.

6. **Recipient address required upfront.** Because notes are encrypted for a specific recipient, there's no "send to anyone with the link" pattern possible. The link only works for the intended recipient.

7. **URL-based delivery is feasible.** Estimated ~2,100 chars for a transfer link — within browser URL limits and QR code capacity. This validates URLs as a practical delivery channel for single-note transfers.
