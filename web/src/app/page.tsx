'use client';
import { useState, useCallback } from 'react';
import { useWallet } from '@/hooks/useWallet';
import ConnectWallet from '@/components/ConnectWallet';
import FundAccount from '@/components/FundAccount';
import BalanceCard from '@/components/BalanceCard';
import OfwGuardianSplitRemittance from '@/components/OfwGuardianSplitRemittance';

export default function Home() {
  const wallet = useWallet();
  const { publicKey, connecting } = wallet;
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <header className="mb-6 flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Testnet demo only
            </p>
            <h1 className="text-3xl font-bold text-gray-900">
              OFW Guardian Split Remittance
            </h1>
            <p className="mt-2 text-base text-gray-600">
              Time-locked emergency funds with one-click family splitting.
            </p>
          </div>
          <ConnectWallet {...wallet} />
        </header>

        <section className="rounded border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Emergency funds for family, split after guardian claim
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            OFWs may want a simple way to make sure emergency funds can reach
            family members if they become inactive abroad. This app lets an OFW
            lock testnet funds for a guardian wallet using Stellar native
            claimable balances. After the unlock time, the guardian can claim
            the funds and split them to family members or other wallets
            in one multi-operation transaction.
          </p>
          <div className="mt-4 grid gap-3 text-sm text-gray-600 sm:grid-cols-3">
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">1. Lock funds</p>
              <p className="mt-1">Choose the guardian, amount, unlock time, and recipients.</p>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">2. Guardian claims</p>
              <p className="mt-1">The guardian can claim only after the unlock time.</p>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">3. Funds split</p>
              <p className="mt-1">One Stellar transaction pays every family recipient.</p>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded border border-gray-200 bg-white p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Wallet setup</h2>
              <p className="mt-1 text-sm text-gray-600">
                Connect Freighter on Stellar Testnet, then fund your testnet
                wallet with Friendbot.
              </p>
            </div>
            {publicKey && <FundAccount publicKey={publicKey} onFunded={refresh} />}
          </div>

          {!publicKey && !connecting && (
            <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Connect Freighter to create or claim a split-remittance plan. No
              wallet?{' '}
              <a
                href="https://freighter.app"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                Install Freighter
              </a>{' '}
              and switch it to Test Net.
            </div>
          )}

          {publicKey && (
            <>
              <BalanceCard publicKey={publicKey} refreshKey={refreshKey} />
              <button
                onClick={refresh}
                className="mt-3 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Refresh balances
              </button>
            </>
          )}
        </section>

        <OfwGuardianSplitRemittance publicKey={publicKey} onChanged={refresh} />

        <footer className="mt-10 text-center text-xs text-gray-400">
          Built for the StellarX PH workshop @ PUP QC · Stellar Testnet only ·
          no real funds.
        </footer>
      </div>
    </main>
  );
}
