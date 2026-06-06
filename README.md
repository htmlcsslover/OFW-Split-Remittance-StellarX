# OFW Guardian: Split & Save

**Empowering Overseas Filipino Workers with conditional remittances, automated split payments, and smart savings targets on Stellar.**

---

## 🚀 One-Line Description
A decentralized remittance management platform that allows OFWs to lock funds for guardians and automate distribution to multiple family members using Stellar Claimable Balances and Soroban Smart Contracts.

## 😟 The Problem
Overseas Filipino Workers (OFWs) contribute significantly to the Philippine economy, yet they face three major challenges with traditional remittances:
1.  **Lack of Control:** Once money is sent, OFWs have little visibility or control over whether it is spent on intended essentials (tuition, bills) or saved for the future.
2.  **Distribution Friction:** Sending small amounts to multiple family members (e.g., three children and a parent) incurs multiple transaction fees and requires significant manual effort.
3.  **Savings Leakage:** Without a dedicated, transparent mechanism, "extra" money is often consumed by daily expenses rather than being funneled into long-term savings goals.

## 🛠 How It Works
OFW Guardian provides a structured workflow for family-centric financial management:

1.  **Family Registration:** The OFW (Host) registers the Stellar public keys of a Guardian (Parent) and multiple Recipients (Children).
2.  **Conditional Lock (Host):** The OFW creates a **Claimable Balance** on Stellar, locking XLM/USDC until a specific date (e.g., the 1st of next month).
3.  **Autonomous Split (Guardian):** Once the time-lock expires, the Guardian claims the balance. The application immediately builds an **Atomic Split Transaction** that distributes the funds across all registered Recipient wallets in a single ledger entry.
4.  **Savings Goal (Soroban):** A dedicated smart contract allows the family to contribute "leftovers" to a shared savings target, providing a transparent dashboard of their progress toward goals like a "Home Fund" or "Education Fund."

## 🌟 How It Uses Stellar
This project leverages the unique "Lego bricks" of the Stellar ecosystem to ensure security and efficiency:

*   **Claimable Balances & Predicates:** Uses `Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime)` to enforce non-custodial time-locks, ensuring funds are reserved for family needs.
*   **Atomic Multi-Operation Transactions:** Bundles up to 100 individual payments into a single transaction. This ensures that if the Guardian claims the funds, the split to the children happens instantly and atomically, or not at all.
*   **Soroban Smart Contracts:** The `SavingsGoal` contract manages global state for family savings, utilizing Soroban's efficient `instance` storage and TTL management.
*   **Non-Custodial Security:** All transactions are signed via **Freighter**, ensuring the OFW and Guardian maintain full control of their private keys.

## 🎯 Track
**Track 1 – Remittance & Cross-Border**

## 💻 Tech Stack
*   **Frontend:** Next.js 15, TypeScript, Tailwind CSS
*   **Blockchain SDK:** `@stellar/stellar-sdk`
*   **Wallet:** `@stellar/freighter-api`
*   **Smart Contracts:** Soroban (Rust SDK)
*   **Indexing/UI:** Stellar.expert integration

## ⚙️ Setup & Run

### 1. Smart Contract
```bash
cd contracts/savings-goal
cargo build --target wasm32-unknown-unknown --release
# Deploy using the provided scripts in /scripts
```

### 2. Web Application
```bash
cd web
npm install
npm run dev
```

### 3. Environment Variables
Create a `web/.env.local` (or similar) with:
*   `NEXT_PUBLIC_NETWORK_PASSPHRASE`: "Test SDF Network ; September 2015"
*   `NEXT_PUBLIC_HORIZON_URL`: "https://horizon-testnet.stellar.org"

## 🌐 Network Details
*   **Network:** Stellar Testnet
*   **Asset:** Native XLM (with future support for PHP-stablecoins/USDC)

## 👥 Team
*   **Raphael** — [@htmlcsslover](https://github.com/htmlcsslover)

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
