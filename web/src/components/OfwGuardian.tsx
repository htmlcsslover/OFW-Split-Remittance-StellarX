'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  buildClaimGuardianBalanceXDR,
  buildCreateGuardianBalanceXDR,
  fetchClaimableBalancesForClaimant,
  fetchClaimableBalancesSponsoredBy,
  type GuardianClaimableBalance,
} from '@/lib/claimableBalances';
import {
  pollTransaction,
  submitSignedXDR,
  type AssetCode,
} from '@/lib/payment';
import { NETWORK_PASSPHRASE, USDC_ISSUER } from '@/lib/stellar';

type TxStatus =
  | 'idle'
  | 'building'
  | 'waiting'
  | 'submitting'
  | 'confirmed'
  | 'failed';

const STATUS_TEXT: Record<TxStatus, string> = {
  idle: 'Ready',
  building: 'Building transaction',
  waiting: 'Waiting for Freighter',
  submitting: 'Submitting to testnet',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

function getInitialUnlockValue() {
  const date = new Date(Date.now() + 10 * 60 * 1000);
  date.setSeconds(0, 0);
  return date.toISOString().slice(0, 16);
}

function formatUnlock(date: Date | null) {
  if (!date) return 'Available when predicate allows';
  return date.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function isUnlocked(unlockAt: Date | null, now: number) {
  return Boolean(unlockAt && unlockAt.getTime() <= now);
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();

  if (lower.includes('user declined') || lower.includes('rejected')) {
    return 'Freighter signing was rejected. No transaction was submitted.';
  }
  if (
    lower.includes('network') &&
    (lower.includes('passphrase') || lower.includes('test'))
  ) {
    return 'Freighter must be connected to Stellar Testnet for this demo.';
  }
  if (lower.includes('tx_bad_auth')) {
    return 'The signed transaction was rejected. Confirm Freighter is on Stellar Testnet and try again.';
  }
  return message;
}

export default function OfwGuardian({
  publicKey,
  onChanged,
}: {
  publicKey: string | null;
  onChanged: () => void;
}) {
  const [beneficiary, setBeneficiary] = useState('');
  const [amount, setAmount] = useState('');
  const [assetCode, setAssetCode] = useState<AssetCode>('XLM');
  const [unlockAt, setUnlockAt] = useState(getInitialUnlockValue);
  const [status, setStatus] = useState<TxStatus>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [txHash, setTxHash] = useState('');
  const [balances, setBalances] = useState<GuardianClaimableBalance[]>([]);
  const [sponsoredBalances, setSponsoredBalances] = useState<
    GuardianClaimableBalance[]
  >([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [claimingId, setClaimingId] = useState('');
  const [now, setNow] = useState(0);

  const busy = ['building', 'waiting', 'submitting'].includes(status);
  const stellarExpertLink = txHash
    ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
    : '';

  const canCreate = useMemo(
    () => publicKey && amount.trim() && unlockAt && !busy,
    [amount, busy, publicKey, unlockAt],
  );

  const refreshBalances = useCallback(async () => {
    if (!publicKey) {
      setBalances([]);
      setSponsoredBalances([]);
      return;
    }

    setLoadingBalances(true);
    try {
      const [nextBalances, nextSponsoredBalances] = await Promise.all([
        fetchClaimableBalancesForClaimant(publicKey),
        fetchClaimableBalancesSponsoredBy(publicKey),
      ]);
      setBalances(nextBalances);
      setSponsoredBalances(nextSponsoredBalances);
    } catch (error: unknown) {
      setStatus('failed');
      setStatusDetail(friendlyError(error, 'Could not load claimable balances.'));
    } finally {
      setLoadingBalances(false);
    }
  }, [publicKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshBalances();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshBalances]);

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      setNow(Date.now());
    }, 0);
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, []);

  const signAndSubmit = async (xdr: string) => {
    if (!publicKey) {
      throw new Error('Connect Freighter before signing a transaction.');
    }

    setStatus('waiting');
    const freighter = await import('@stellar/freighter-api');
    const signed = await freighter.signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: publicKey,
    });
    if (signed.error) {
      throw new Error(
        typeof signed.error === 'string' ? signed.error : 'Signing was rejected',
      );
    }

    setStatus('submitting');
    const hash = await submitSignedXDR(signed.signedTxXdr);
    setTxHash(hash);
    await pollTransaction(hash);
    setStatus('confirmed');
    return hash;
  };

  const handleCreate = async () => {
    if (!publicKey) {
      setStatus('failed');
      setStatusDetail('Connect Freighter on Stellar Testnet before creating a guardian balance.');
      return;
    }
    if (!beneficiary.trim()) {
      setStatus('failed');
      setStatusDetail('Add a family wallet address before locking an amount.');
      return;
    }

    setStatus('building');
    setStatusDetail('Preparing the OFW Guardian lock on Stellar Testnet.');
    setTxHash('');
    try {
      const xdr = await buildCreateGuardianBalanceXDR({
        source: publicKey,
        beneficiary,
        amount,
        unlockAt: new Date(unlockAt),
        assetCode,
      });

      await signAndSubmit(xdr);
      setStatusDetail('Guardian balance created. The family wallet can claim after the unlock time.');
      setAmount('');
      setBeneficiary('');
      setUnlockAt(getInitialUnlockValue());
      await refreshBalances();
      onChanged();
    } catch (error: unknown) {
      setStatus('failed');
      setStatusDetail(friendlyError(error, 'Could not create claimable balance.'));
    }
  };

  const handleClaim = async (balanceId: string) => {
    if (!publicKey) {
      setStatus('failed');
      setStatusDetail('Connect the beneficiary wallet before claiming funds.');
      return;
    }

    const selectedBalance = balances.find((balance) => balance.id === balanceId);
    if (!selectedBalance || !isUnlocked(selectedBalance.unlockAt, now)) {
      setStatus('failed');
      setStatusDetail('This balance is still locked. It can be claimed after the unlock time.');
      return;
    }

    setClaimingId(balanceId);
    setStatus('building');
    setStatusDetail('Preparing claim transaction for this family wallet.');
    setTxHash('');
    try {
      const xdr = await buildClaimGuardianBalanceXDR(publicKey, balanceId);
      await signAndSubmit(xdr);
      setStatusDetail('Funds claimed into the connected wallet.');
      await refreshBalances();
      onChanged();
    } catch (error: unknown) {
      setStatus('failed');
      setStatusDetail(friendlyError(error, 'Could not claim this balance.'));
    } finally {
      setClaimingId('');
    }
  };

  return (
    <section className="mt-6 rounded border border-gray-200 bg-white p-6">
      <div className="mb-5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Testnet demo
        </p>
        <h2 className="text-lg font-semibold text-gray-900">OFW Guardian</h2>
        <p className="mt-2 text-sm text-gray-600">
          A simple inheritance and emergency release demo using Stellar native
          claimable balances. No real funds are used.
        </p>
      </div>

      <ol className="mb-6 list-decimal space-y-1 pl-5 text-sm text-gray-600">
        <li>OFW locks funds for a family wallet.</li>
        <li>Family wallet becomes eligible after the unlock time.</li>
        <li>Family claims funds if needed.</li>
      </ol>

      {!publicKey && (
        <div className="mb-5 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Connect Freighter on Stellar Testnet to create or claim guardian
          balances.
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-gray-600">Asset</label>
          <select
            value={assetCode}
            onChange={(e) => setAssetCode(e.target.value as AssetCode)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
          >
            <option value="XLM">XLM</option>
            <option value="USDC" disabled={!USDC_ISSUER}>
              USDC {!USDC_ISSUER ? '(not configured)' : ''}
            </option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-600">
            Family wallet address
          </label>
          <input
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            placeholder="G... beneficiary testnet address"
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900"
          />
          {!beneficiary.trim() && (
            <p className="mt-1 text-xs text-amber-700">
              Add the family wallet address before locking an amount.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-600">Amount to lock</label>
          <input
            type="number"
            min="0"
            step="0.0000001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-600">
            Family can claim after
          </label>
          <input
            type="datetime-local"
            value={unlockAt}
            onChange={(e) => setUnlockAt(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={!canCreate}
          className="w-full rounded bg-emerald-600 py-3 font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          Create guardian balance
        </button>
      </div>

      <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-700">
          Status: {STATUS_TEXT[status]}
        </p>
        {statusDetail && <p className="mt-1 text-sm text-gray-600">{statusDetail}</p>}
        {stellarExpertLink && status === 'confirmed' && (
          <a
            href={stellarExpertLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block break-all text-sm text-indigo-600 hover:underline"
          >
            View transaction on Stellar Expert →
          </a>
        )}
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-medium text-gray-900">Guardian balances you created</h3>
          <button
            onClick={refreshBalances}
            disabled={!publicKey || loadingBalances || busy}
            className="text-sm text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {loadingBalances && (
          <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
            Loading claimable balances...
          </p>
        )}

        {!loadingBalances && sponsoredBalances.length === 0 && (
          <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
            {publicKey
              ? 'No active guardian balances found where this wallet is the sponsor.'
              : 'Connect a wallet to load guardian balances created by you.'}
          </p>
        )}

        <div className="space-y-3">
          {sponsoredBalances.map((balance) => {
            const unlocked = isUnlocked(balance.unlockAt, now);

            return (
              <div
                key={balance.id}
                className="rounded border border-gray-200 bg-white p-4"
              >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {Number(balance.amount).toLocaleString()} {balance.asset}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Family can claim after: {formatUnlock(balance.unlockAt)}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-gray-500">
                    Family wallet: {balance.claimants[0]?.destination ?? 'Unknown'}
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    unlocked
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {unlocked ? 'Family eligible' : 'Locked'}
                </span>
              </div>
              <Link
                href={`/tx/${balance.id}`}
                className="mt-2 block text-xs font-semibold text-emerald-700 hover:underline"
              >
                View details page &rarr;
              </Link>
              <p className="mt-2 break-all font-mono text-xs text-gray-500">
                {balance.id}
              </p>
            </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-3 font-medium text-gray-900">Balances claimable by you</h3>

        {!loadingBalances && balances.length === 0 && (
          <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
            {publicKey
              ? 'No claimable balances found for this connected wallet.'
              : 'Connect a wallet to load balances claimable by you.'}
          </p>
        )}

        <div className="space-y-3">
          {balances.map((balance) => {
            const unlocked = isUnlocked(balance.unlockAt, now);
            const buttonLabel = unlocked
              ? claimingId === balance.id
                ? 'Claiming...'
                : 'Claim funds'
              : `Locked until ${formatUnlock(balance.unlockAt)}`;

            return (
              <div
                key={balance.id}
                className="rounded border border-gray-200 bg-white p-4"
              >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {Number(balance.amount).toLocaleString()} {balance.asset}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Unlock: {formatUnlock(balance.unlockAt)}
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    unlocked
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {unlocked ? 'Available now' : 'Locked'}
                </span>
              </div>

              <Link
                href={`/tx/${balance.id}`}
                className="mt-2 block text-xs font-semibold text-emerald-700 hover:underline"
              >
                View details page &rarr;
              </Link>

              <p className="mt-2 break-all font-mono text-xs text-gray-500">
                {balance.id}
              </p>

              <button
                onClick={() => handleClaim(balance.id)}
                disabled={!unlocked || busy || claimingId === balance.id}
                className={`mt-3 w-full rounded py-2 text-sm font-medium transition-colors ${
                  unlocked
                    ? 'bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50'
                    : 'cursor-not-allowed border border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {buttonLabel}
              </button>
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
