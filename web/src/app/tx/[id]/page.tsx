'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getGuardianPlan, type GuardianPlan } from '@/lib/guardianPlans';
import { fetchClaimableBalanceById, type GuardianClaimableBalance } from '@/lib/claimableBalances';

export default function TransactionDetailsPage() {
  const { id } = useParams();
  const [plan, setPlan] = useState<GuardianPlan | null>(null);
  const [balance, setBalance] = useState<GuardianClaimableBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      
      const txId = id as string;
      
      // Try to find a local plan first
      const storedPlan = getGuardianPlan(txId);
      if (storedPlan) {
        setPlan(storedPlan);
      } else {
        // If no local plan, try to fetch a claimable balance from the chain
        const onChainBalance = await fetchClaimableBalanceById(txId);
        if (onChainBalance) {
          setBalance(onChainBalance);
        }
      }
      setLoading(false);
    }
    
    loadData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
          <p className="text-gray-500 font-medium">Loading details...</p>
        </div>
      </div>
    );
  }

  if (!plan && !balance) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Transaction not found</h1>
        <p className="mt-2 text-gray-600">
          The transaction ID could not be found in local storage or on the Stellar testnet.
        </p>
        <Link
          href="/"
          className="mt-6 rounded bg-emerald-600 px-6 py-2 font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const formatDateTime = (value?: string | Date | null) => {
    if (!value) return 'Available when predicate allows';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Available when predicate allows';
    return date.toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
  };

  const expertTx = (hash?: string) =>
    hash ? `https://stellar.expert/explorer/testnet/tx/${hash}` : '';

  const expertAccount = (address?: string) =>
    address ? `https://stellar.expert/explorer/testnet/account/${address}` : '';

  // Render Logic for Guardian Plan (Local)
  if (plan) {
    return (
      <main className="min-h-screen bg-gray-50 py-10">
        <div className="mx-auto max-w-3xl px-4">
          <div className="mb-6">
            <Link
              href="/"
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              &larr; Back to Dashboard
            </Link>
          </div>

          <header className="mb-8 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="bg-emerald-600 px-6 py-4">
              <h1 className="text-xl font-bold text-white">Guardian Split Plan</h1>
              <p className="text-sm text-emerald-100 opacity-90 truncate">
                ID: {plan.id}
              </p>
            </div>
            <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Total Locked
                </p>
                <p className="text-3xl font-bold text-gray-900">
                  {plan.totalAmount} <span className="text-lg font-semibold">{plan.asset}</span>
                </p>
              </div>
              <div className="inline-flex items-center rounded-full bg-emerald-100 px-4 py-1 text-sm font-semibold text-emerald-800">
                <span className="capitalize">{plan.status.replace('_', ' ')}</span>
              </div>
            </div>
          </header>

          <div className="space-y-6">
            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Timeline</h2>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Created At</p>
                  <p className="mt-1 text-sm text-gray-900">{formatDateTime(plan.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Unlock Date</p>
                  <p className="mt-1 text-sm text-gray-900 font-semibold text-emerald-700">
                    {formatDateTime(plan.unlockAt)}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Participants</h2>
              <div className="space-y-4">
                <div className="rounded border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-tight">Parent / Guardian (Claimant)</p>
                  <div className="mt-2 flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-gray-900">{plan.parent.label}</p>
                      <a
                        href={expertAccount(plan.parent.publicKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block break-all font-mono text-xs text-indigo-600 hover:underline"
                      >
                        {plan.parent.publicKey}
                      </a>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-tight">Final Recipients (Split Payment)</p>
                  {plan.children.map((child) => (
                    <div key={child.id} className="rounded border border-gray-100 p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-gray-900">{child.label}</p>
                        <p className="font-bold text-gray-900">{child.amount} XLM</p>
                      </div>
                      <a
                        href={expertAccount(child.publicKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block break-all font-mono text-xs text-gray-500 hover:underline"
                      >
                        {child.publicKey}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Stellar Testnet Data</h2>
              <div className="space-y-3">
                {plan.createTxHash && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-gray-500 uppercase">Creation Hash</p>
                    <a
                      href={expertTx(plan.createTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm text-indigo-600 hover:underline"
                    >
                      {plan.createTxHash}
                    </a>
                  </div>
                )}
                {plan.claimableBalanceId && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-gray-500 uppercase">Claimable Balance ID</p>
                    <p className="truncate font-mono text-sm text-gray-900">{plan.claimableBalanceId}</p>
                  </div>
                )}
                {plan.claimTxHash && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-gray-500 uppercase">Claim Hash</p>
                    <a
                      href={expertTx(plan.claimTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm text-indigo-600 hover:underline"
                    >
                      {plan.claimTxHash}
                    </a>
                  </div>
                )}
                {plan.splitTxHash && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-gray-500 uppercase">Split Payment Hash</p>
                    <a
                      href={expertTx(plan.splitTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm text-indigo-600 hover:underline"
                    >
                      {plan.splitTxHash}
                    </a>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  // Render Logic for On-Chain Claimable Balance
  if (balance) {
    return (
      <main className="min-h-screen bg-gray-50 py-10">
        <div className="mx-auto max-w-3xl px-4">
          <div className="mb-6">
            <Link
              href="/"
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              &larr; Back to Dashboard
            </Link>
          </div>

          <header className="mb-8 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="bg-indigo-600 px-6 py-4">
              <h1 className="text-xl font-bold text-white">Claimable Balance</h1>
              <p className="text-sm text-indigo-100 opacity-90 truncate">
                ID: {balance.id}
              </p>
            </div>
            <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </p>
                <p className="text-3xl font-bold text-gray-900">
                  {balance.amount} <span className="text-lg font-semibold">{balance.asset}</span>
                </p>
              </div>
              <div className={`inline-flex items-center rounded-full px-4 py-1 text-sm font-semibold ${balance.claimableNow ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                <span>{balance.claimableNow ? 'Available' : 'Locked'}</span>
              </div>
            </div>
          </header>

          <div className="space-y-6">
            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Unlock Condition</h2>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-tight">Earliest Claim Date</p>
                <p className={`mt-1 text-lg font-semibold ${balance.claimableNow ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {formatDateTime(balance.unlockAt)}
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Claimants</h2>
              <div className="space-y-3">
                {balance.claimants.map((c, i) => (
                  <div key={i} className="rounded border border-gray-100 bg-gray-50 p-4">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-tight">Recipient {i + 1}</p>
                    <a
                      href={expertAccount(c.destination)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block break-all font-mono text-sm text-indigo-600 hover:underline"
                    >
                      {c.destination}
                    </a>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm text-center">
              <p className="text-sm text-gray-500">
                This transaction data is fetched directly from the Stellar testnet.
              </p>
              <a
                href={`https://stellar.expert/explorer/testnet/claimable-balance/${balance.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block font-medium text-emerald-700 hover:underline"
              >
                View on Stellar Expert &rarr;
              </a>
            </section>
          </div>
        </div>
      </main>
    );
  }

  return null;
}
