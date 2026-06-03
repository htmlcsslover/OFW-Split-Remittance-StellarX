# StellarX Workshop Starter Skill

## Repository Purpose

This repository is a starter scaffold for the StellarX PH workshop at PUP QC. It is designed to give AI coding agents and workshop participants a working Stellar testnet application that can be extended without rebuilding the foundation.

The repository has two connected parts:

- A Next.js frontend in `web/` that connects to Freighter, funds a testnet account with Friendbot, reads balances, sends testnet payments, and invokes a Soroban contract.
- A Rust Soroban smart contract in `contracts/savings-goal/` that tracks a simple savings goal with `init`, `contribute`, and `get_state`.

The frontend talks to Stellar testnet through Stellar SDK clients. It uses Horizon-style account and transaction APIs for balances and payments, Soroban RPC for contract calls, and Freighter for user wallet access and transaction signing. The contract is built and deployed with Stellar CLI, then the deployed contract ID is written into the frontend environment so the Savings Goal panel can read and submit contract interactions.

## Architecture Overview

### `web/`

`web/` contains the Next.js 16 frontend using TypeScript, React, and Tailwind CSS. Important areas:

- `web/src/app/page.tsx` wires together the workshop UI.
- `web/src/components/` contains the wallet, funding, balance, payment, trustline, and Savings Goal UI.
- `web/src/hooks/useWallet.ts` owns Freighter connection state and wallet errors.
- `web/src/lib/stellar.ts` defines testnet Stellar configuration, SDK clients, assets, and Friendbot funding.
- `web/src/lib/payment.ts` builds, submits, and polls classic payment transactions.
- `web/src/lib/contract.ts` reads and invokes the Savings Goal Soroban contract.
- `web/src/lib/sign.ts` and `web/src/lib/trustline.ts` keep reusable Stellar transaction logic out of UI components.

### `contracts/`

`contracts/` contains Soroban smart contracts. The current example is:

- `contracts/savings-goal/src/lib.rs`: the Savings Goal contract.
- `contracts/savings-goal/src/test.rs`: unit tests for contract behavior.

The contract is intentionally simple for workshop reliability. It stores integer state for `saved` and `target`; it does not transfer tokens.

### `scripts/`

`scripts/` contains deployment helpers:

- `scripts/deploy.sh`: macOS/Linux deploy flow.
- `scripts/deploy.ps1`: Windows PowerShell deploy flow.

The deploy scripts create or reuse a funded testnet identity, build the contract, deploy it to testnet, initialize the goal target, and write `NEXT_PUBLIC_CONTRACT_ID` into `web/.env.local`.

### Cargo Workspace

The root `Cargo.toml` defines a Rust workspace with `contracts/*` members and shared `soroban-sdk = "22"`. Release settings are optimized for Soroban WASM size limits.

Use root-level Cargo commands for contract work:

```bash
cargo test
stellar contract build
```

### Environment Configuration

The frontend reads public testnet configuration from `web/.env.local`:

- `NEXT_PUBLIC_SOROBAN_RPC`
- `NEXT_PUBLIC_HORIZON_URL`
- `NEXT_PUBLIC_USDC_ISSUER`
- `NEXT_PUBLIC_CONTRACT_ID`

Defaults in code point to Stellar testnet RPC and Horizon where possible. `NEXT_PUBLIC_CONTRACT_ID` is empty until the contract is deployed. Restart `npm run dev` after changing environment variables.

## Technology Stack

- **Next.js 16**: App Router frontend framework. Check local Next.js docs in `web/node_modules/next/dist/docs/` before changing framework-specific APIs because this version may differ from older training data.
- **TypeScript**: Used across the frontend. Keep types explicit around Stellar responses, wallet state, transaction status, and contract return values.
- **Tailwind CSS**: Used for styling. Preserve existing class-based styling conventions and component structure.
- **Stellar SDK**: `@stellar/stellar-sdk` v15. Use the `rpc` namespace for Soroban RPC; do not use the old `SorobanRpc` namespace.
- **Freighter**: Browser wallet integration through `@stellar/freighter-api` v6. Import dynamically inside browser-only code. `signTransaction` returns an object containing `signedTxXdr`.
- **Soroban**: Stellar smart contract platform used for the Savings Goal contract. Simulate Soroban transactions before signing and submitting.
- **Rust**: Used for Soroban contract implementation and unit tests.
- **Stellar CLI**: Used to build, deploy, initialize, and invoke contracts on testnet.

## Development Workflow

1. Run the frontend:

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

2. Connect Freighter:

- Install and unlock Freighter.
- Switch Freighter to Test Net.
- Connect through the UI and approve the request.

3. Fund via Friendbot:

- Use the frontend Friendbot action for the connected testnet public key.
- A funded account should receive about 10,000 testnet XLM.

4. Deploy the contract:

```bash
# from repo root
cargo test
./scripts/deploy.sh
```

On Windows:

```powershell
cargo test
.\scripts\deploy.ps1
```

5. Update the contract ID:

- The deploy script writes `NEXT_PUBLIC_CONTRACT_ID` into `web/.env.local`.
- If deploying manually, update `web/.env.local` yourself.
- Restart the Next.js dev server after changing the contract ID.

6. Test transactions:

- Send a testnet XLM payment to an existing funded testnet destination.
- Watch the frontend transaction lifecycle states.
- Verify the hash in Stellar Expert testnet.
- Test the Savings Goal panel by reading state and submitting a `contribute` transaction through Freighter.

## Smart Contract Guidelines

- Keep contract logic simple, deterministic, and workshop-friendly.
- Prefer integer values such as `i128` for contract state and arguments.
- Avoid floats, timestamps for core logic, and nondeterministic behavior.
- Avoid unnecessary storage writes; write only state that has changed.
- Use instance storage intentionally and extend TTL where needed.
- Maintain testnet compatibility with the current Stellar CLI and `soroban-sdk` version.
- Add or update unit tests for every behavior change.
- Preserve clear errors for invalid state transitions, invalid amounts, and initialization rules.
- Keep the Savings Goal example easy to explain before adding advanced token transfer logic.

## Frontend Guidelines

- Use TypeScript strictly and avoid `any` unless a Stellar SDK type cannot reasonably express the response.
- Reuse existing UI patterns in `web/src/components/`.
- Keep Stellar logic in reusable helpers under `web/src/lib/` rather than embedding transaction code inside components.
- Keep wallet state in hooks such as `useWallet`.
- Surface wallet, funding, signing, simulation, submission, and polling errors clearly in the UI.
- Preserve existing Tailwind styling conventions and component composition.
- Keep demo flows beginner-friendly: visible states, readable labels, and simple success or error messages.
- Do not statically import Freighter in server-rendered modules; use dynamic imports in browser-only code.

## Stellar Integration Rules

- Always use Stellar testnet. Do not add mainnet behavior to this starter unless explicitly requested.
- Never hardcode secret keys, seed phrases, or private keys.
- Use Freighter for user signing.
- Verify network passphrases with `Networks.TESTNET`; avoid hand-written passphrase strings.
- Validate destination accounts before sending payments when adding new payment flows.
- Handle complete transaction lifecycle states: building, signing, submitting, pending, polling, success, and failure.
- Treat `sendTransaction` returning `PENDING` as incomplete; poll `getTransaction` until finality or timeout.
- Always simulate Soroban transactions before signing and submitting them.
- Use Soroban RPC for contract calls and Horizon-compatible APIs for balances or classic payment history.
- Validate trustlines before sending or receiving non-native assets such as USDC.

## Repository Conventions

- Maintain the existing folder structure: frontend in `web/`, contracts in `contracts/`, scripts in `scripts/`.
- Avoid unnecessary dependencies, especially for beginner workshop flows.
- Prefer incremental changes over broad rewrites.
- Preserve the working payment demo flow.
- Do not break existing Freighter connection, Friendbot funding, balance display, payment submission, or contract contribution behavior.
- Keep names and examples understandable for workshop participants.
- Use existing helpers and components before creating new abstractions.
- Explain architectural changes before large refactors.

## Testing Expectations

### Frontend Verification

- Run `npm run lint` in `web/` after frontend changes.
- Run `npm run build` in `web/` for larger changes or framework-level edits.
- Start `npm run dev` and confirm the app loads at `http://localhost:3000`.

### Wallet Connection Verification

- Confirm Freighter is detected when installed and unlocked.
- Confirm the UI shows a connected public key after approval.
- Confirm missing, locked, rejected, or timed-out wallet states show useful errors.
- Confirm Freighter is set to Test Net before testing transactions.

### Payment Verification

- Fund the sender with Friendbot.
- Use a destination account that exists and is funded.
- Send a small XLM testnet payment.
- Confirm lifecycle states progress through signing, submitting, confirming, and success.
- Verify the transaction hash in Stellar Expert testnet.
- Confirm failures such as missing destination or rejected signature are shown clearly.

### Contract Deployment Verification

- Run `cargo test` from the repository root.
- Run `stellar contract build`.
- Deploy with `scripts/deploy.sh` or `scripts/deploy.ps1`.
- Confirm `NEXT_PUBLIC_CONTRACT_ID` is written to `web/.env.local`.
- Restart the frontend dev server after environment changes.

### Contract Interaction Verification

- Confirm the Savings Goal panel reads `{ saved, target }`.
- Confirm `contribute` builds, simulates, signs through Freighter, submits, polls, and updates state.
- Confirm invalid contribution values are rejected.
- Confirm contract errors are surfaced in a beginner-readable way.

## Common Tasks

### Running Frontend

```bash
cd web
npm install
npm run dev
```

### Installing Dependencies

Frontend dependencies:

```bash
cd web
npm install
```

Contract prerequisites:

```bash
rustup target add wasm32v1-none
stellar --version
```

### Deploying Contracts

From the repository root:

```bash
cargo test
./scripts/deploy.sh
```

Windows:

```powershell
cargo test
.\scripts\deploy.ps1
```

### Updating Environment Variables

Edit or create `web/.env.local`:

```bash
NEXT_PUBLIC_SOROBAN_RPC=https://soroban-testnet.stellar.org
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
NEXT_PUBLIC_CONTRACT_ID=YOUR_DEPLOYED_CONTRACT_ID
```

Restart `npm run dev` after changes.

### Verifying Stellar Transactions

- Use the transaction hash returned by the frontend.
- Open `https://stellar.expert/explorer/testnet`.
- Search for the hash and confirm the operation, source account, destination, asset, amount, and success status.

## AI Agent Instructions

- Read `README.md` first.
- Read `CLAUDE.md` before implementing features.
- Read `web/AGENTS.md` before changing Next.js code.
- Preserve Stellar testnet functionality.
- Prefer modifying existing components and helpers over rewriting the app.
- Keep Stellar SDK usage compatible with v15 and Freighter usage compatible with v6.
- Keep Soroban logic compatible with `soroban-sdk` 22 and Stellar CLI workflows.
- Explain architectural changes before large refactors.
- Keep changes workshop-friendly, beginner-friendly, and easy to demonstrate live.
- Do not introduce production mainnet assumptions, custodial key handling, or secret-key storage.
- Preserve the working demo flows unless the user explicitly asks to replace them.
