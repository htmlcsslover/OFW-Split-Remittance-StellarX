'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fetchBalances } from '@/lib/balances';
import {
  buildClaimGuardianBalanceXDR,
  buildCreateGuardianBalanceXDR,
  fetchClaimableBalancesForClaimant,
  validateFutureUnlock,
  validatePositiveAmount,
  validatePublicKey,
  type GuardianClaimableBalance,
} from '@/lib/claimableBalances';
import {
  loadGuardianPlans,
  updateGuardianPlan,
  upsertGuardianPlan,
  type FamilyMemberStatus,
  type GuardianChild,
  type GuardianParent,
  type GuardianPlan,
} from '@/lib/guardianPlans';
import { pollTransaction, submitSignedXDR } from '@/lib/payment';
import { buildSplitPaymentXDR, validateSplitRecipients } from '@/lib/splitPayments';
import { NETWORK_PASSPHRASE } from '@/lib/stellar';

type TxStatus = 'idle' | 'building' | 'waiting' | 'submitting' | 'confirmed' | 'failed';

const STATUS_LABEL: Record<TxStatus, string> = {
  idle: 'Ready',
  building: 'Building transaction',
  waiting: 'Waiting for Freighter',
  submitting: 'Submitting to Stellar testnet',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

const emptyParent: GuardianParent = {
  label: 'Parent / Guardian',
  publicKey: '',
  status: 'pending',
};

function makeChild(id: string, label = 'Wallet'): GuardianChild {
  return { id, label, publicKey: '', amount: '', status: 'pending' };
}

function getInitialUnlockValue() {
  const date = new Date(Date.now() + 5 * 60 * 1000);
  date.setSeconds(0, 0);
  return date.toISOString().slice(0, 16);
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'Unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function isUnlocked(unlockAt: string, now: number) {
  return new Date(unlockAt).getTime() <= now;
}

function expertTx(hash?: string) {
  return hash ? `https://stellar.expert/explorer/testnet/tx/${hash}` : '';
}

function statusPill(status: FamilyMemberStatus) {
  return status === 'confirmed' ? 'Confirmed' : 'Not verified';
}

function parseAmount(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value: number) {
  return value.toFixed(7).replace(/\.?0+$/, '');
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();
  if (lower.includes('user declined') || lower.includes('rejected')) {
    return 'Freighter signing was rejected. No transaction was submitted.';
  }
  if (lower.includes('not funded') || lower.includes('does not exist')) {
    return 'Account does not exist on testnet. Please fund this wallet first using Friendbot.';
  }
  if (lower.includes('invalid') && lower.includes('stellar')) {
    return 'Invalid Stellar address.';
  }
  if (lower.includes('tx_bad_auth') || lower.includes('passphrase')) {
    return 'Confirm Freighter is connected to Stellar Testnet, then try again.';
  }
  return message;
}

const renderLinks = (plan: GuardianPlan) => (
  <div className="mt-3 space-y-1 text-xs">
    <Link
      href={`/tx/${plan.id}`}
      className="block font-semibold text-emerald-700 hover:underline"
    >
      View details page &rarr;
    </Link>
    {plan.createTxHash && (
      <a
        href={expertTx(plan.createTxHash)}
        target="_blank"
        rel="noopener noreferrer"
        className="block break-all text-indigo-600 hover:underline"
      >
        Creation transaction
      </a>
    )}
    {plan.claimTxHash && (
      <a
        href={expertTx(plan.claimTxHash)}
        target="_blank"
        rel="noopener noreferrer"
        className="block break-all text-indigo-600 hover:underline"
      >
        Claim transaction
      </a>
    )}
    {plan.splitTxHash && (
      <a
        href={expertTx(plan.splitTxHash)}
        target="_blank"
        rel="noopener noreferrer"
        className="block break-all text-indigo-600 hover:underline"
      >
        Split payment transaction
      </a>
    )}
  </div>
);

export default function OfwGuardianSplitRemittance({
  publicKey,
  onChanged,
}: {
  publicKey: string | null;
  onChanged: () => void;
}) {
  const [parent, setParent] = useState<GuardianParent>(emptyParent);
  const [children, setChildren] = useState<GuardianChild[]>([
    makeChild('child-1', 'Wallet 1'),
  ]);
  const [unlockAt, setUnlockAt] = useState(getInitialUnlockValue);
  const [totalAmount, setTotalAmount] = useState('');
  const [plans, setPlans] = useState<GuardianPlan[]>([]);
  const [claimableBalances, setClaimableBalances] = useState<
    GuardianClaimableBalance[]
  >([]);
  const [status, setStatus] = useState<TxStatus>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [activePlanId, setActivePlanId] = useState('');
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [now, setNow] = useState(0);

  const busy = ['building', 'waiting', 'submitting'].includes(status);
  const hostPlans = useMemo(
    () => (publicKey ? plans.filter((plan) => plan.hostPublicKey === publicKey) : []),
    [plans, publicKey],
  );
  const guardianPlans = useMemo(
    () => (publicKey ? plans.filter((plan) => plan.parent.publicKey === publicKey) : []),
    [plans, publicKey],
  );
  const childPlans = useMemo(
    () =>
      publicKey
        ? plans.filter((plan) =>
            plan.children.some((child) => child.publicKey === publicKey),
          )
        : [],
    [plans, publicKey],
  );
  const canActAsNewHost = Boolean(publicKey && plans.length === 0);
  const isHost = Boolean(publicKey && (canActAsNewHost || hostPlans.length > 0));
  const isGuardian = guardianPlans.length > 0;
  const isChild = childPlans.length > 0;
  const isOtherWallet = Boolean(publicKey && !isHost && !isGuardian && !isChild);
  const totalLockedNumber = parseAmount(totalAmount);
  const splitTotalNumber = children.reduce(
    (sum, child) => sum + parseAmount(child.amount),
    0,
  );
  const splitMatchesTotal =
    totalLockedNumber > 0 &&
    Math.abs(splitTotalNumber - totalLockedNumber) < 0.0000001;

  const refreshPlans = useCallback(async () => {
    const storedPlans = loadGuardianPlans();
    setPlans(storedPlans);

    if (!publicKey) {
      setClaimableBalances([]);
      return;
    }

    setLoadingPlans(true);
    try {
      setClaimableBalances(await fetchClaimableBalancesForClaimant(publicKey));
    } catch (error: unknown) {
      setStatus('failed');
      setStatusDetail(friendlyError(error, 'Could not load guardian plans.'));
    } finally {
      setLoadingPlans(false);
    }
  }, [publicKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshPlans();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshPlans]);

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

  const verifyAccountExists = async (address: string, label: string) => {
    const publicAddress = validatePublicKey(address, label);
    const balances = await fetchBalances(publicAddress);
    if (!balances.funded) {
      throw new Error('Account does not exist on testnet.');
    }
    return publicAddress;
  };

  const verifyParent = async () => {
    setStatus('building');
    setStatusDetail('Verifying parent wallet on Stellar testnet.');
    try {
      const verifiedKey = await verifyAccountExists(parent.publicKey, 'Parent wallet');
      setParent({ ...parent, publicKey: verifiedKey, status: 'confirmed' });
      setStatus('confirmed');
      setStatusDetail('Parent confirmed.');
    } catch (error: unknown) {
      setParent({ ...parent, status: 'pending' });
      setStatus('failed');
      setStatusDetail(friendlyError(error, 'Could not verify parent wallet.'));
    }
  };

  const updateChild = (
    id: string,
    field: keyof Omit<GuardianChild, 'id' | 'status'>,
    value: string,
  ) => {
    setChildren((currentChildren) =>
      currentChildren.map((child) =>
        child.id === id ? { ...child, [field]: value, status: 'pending' } : child,
      ),
    );
  };

  const verifyChild = async (id: string) => {
    const child = children.find((currentChild) => currentChild.id === id);
    if (!child) return;

    setStatus('building');
    setStatusDetail(`Verifying ${child.label || 'Wallet'} on Stellar testnet.`);
    try {
      const verifiedKey = await verifyAccountExists(child.publicKey, 'Wallet');
      setChildren((currentChildren) =>
        currentChildren.map((currentChild) =>
          currentChild.id === id
            ? { ...currentChild, publicKey: verifiedKey, status: 'confirmed' }
            : currentChild,
        ),
      );
      setStatus('confirmed');
      setStatusDetail('Wallet confirmed.');
    } catch (error: unknown) {
      setStatus('failed');
      setStatusDetail(friendlyError(error, 'Could not verify Wallet.'));
    }
  };

  const addChild = () => {
    setChildren((currentChildren) => [
      ...currentChildren,
      makeChild(`child-${currentChildren.length + 1}-${now}`, `Wallet ${currentChildren.length + 1}`),
    ]);
  };

  const fillSplitFromTotal = () => {
    if (totalLockedNumber <= 0 || children.length === 0) {
      setStatus('failed');
      setStatusDetail('Enter the total locked amount first.');
      return;
    }

    const baseAmount = Math.floor((totalLockedNumber / children.length) * 10_000_000) / 10_000_000;
    const nextChildren = children.map((child, index) => {
      const amount =
        index === children.length - 1
          ? totalLockedNumber - baseAmount * (children.length - 1)
          : baseAmount;
      return { ...child, amount: formatAmount(amount) };
    });
    setChildren(nextChildren);
    setStatus('idle');
    setStatusDetail('Split amounts filled from the total locked amount.');
  };

  const removeChild = (id: string) => {
    setChildren((currentChildren) =>
      currentChildren.length === 1
        ? currentChildren
        : currentChildren.filter((child) => child.id !== id),
    );
  };

  const signAndSubmit = async (xdr: string) => {
    if (!publicKey) throw new Error('Connect Freighter before signing.');
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
    await pollTransaction(hash);
    setStatus('confirmed');
    return hash;
  };

  const findCreatedBalanceId = async (
    guardian: string,
    amount: string,
    unlockDate: Date,
  ) => {
    const balances = await fetchClaimableBalancesForClaimant(guardian);
    const match = balances.find((balance) => {
      const sameAmount = Number(balance.amount) === Number(amount);
      const sameUnlock =
        balance.unlockAt &&
        Math.abs(balance.unlockAt.getTime() - unlockDate.getTime()) < 120_000;
      return sameAmount && sameUnlock;
    });
    return match?.id ?? balances[0]?.id ?? '';
  };

  const createPlan = async () => {
    if (!publicKey || !isHost) {
      setStatus('failed');
      setStatusDetail('Connected wallet must be the Host / OFW to create a plan.');
      return;
    }

    setStatus('building');
    setStatusDetail('Validating family registration and split amounts.');
    try {
      if (parent.status !== 'confirmed') {
        throw new Error('Parent wallet must be confirmed before creating a plan.');
      }
      if (children.length === 0 || children.some((child) => child.status !== 'confirmed')) {
        throw new Error('At least one recipient wallet is required and every wallet must be confirmed.');
      }
      const amount = validatePositiveAmount(totalAmount);
      const unlockDate = validateFutureUnlock(new Date(unlockAt));
      validateSplitRecipients(amount, children);

      setStatusDetail('Creating one time-locked claimable balance for the parent / guardian.');
      const createXdr = await buildCreateGuardianBalanceXDR({
        source: publicKey,
        beneficiary: parent.publicKey,
        amount,
        unlockAt: unlockDate,
        assetCode: 'XLM',
      });
      const createTxHash = await signAndSubmit(createXdr);
      const claimableBalanceId = await findCreatedBalanceId(
        parent.publicKey,
        amount,
        unlockDate,
      );
      if (!claimableBalanceId) {
        throw new Error('Plan created, but the claimable balance ID was not found yet. Refresh and try again.');
      }

      const plan: GuardianPlan = {
        id: createTxHash,
        hostPublicKey: publicKey,
        parent,
        children,
        totalAmount: amount,
        asset: 'XLM',
        unlockAt: unlockDate.toISOString(),
        claimableBalanceId,
        createTxHash,
        status: 'locked',
        createdAt: new Date(now || Date.now()).toISOString(),
      };

      setPlans(upsertGuardianPlan(plan));
      setStatus('confirmed');
      setStatusDetail('Guardian plan locked and saved locally.');
      setTotalAmount('');
      setUnlockAt(getInitialUnlockValue());
      await refreshPlans();
      onChanged();
    } catch (error: unknown) {
      setStatus('failed');
      setStatusDetail(friendlyError(error, 'Could not create guardian plan.'));
    }
  };

  const claimAndSplit = async (plan: GuardianPlan) => {
    if (!publicKey || publicKey !== plan.parent.publicKey) {
      setStatus('failed');
      setStatusDetail('Connected wallet must be the parent / guardian to claim and split.');
      return;
    }
    if (!plan.claimableBalanceId) {
      setStatus('failed');
      setStatusDetail('Missing claimable balance ID for this plan.');
      return;
    }
    if (!isUnlocked(plan.unlockAt, now)) {
      setStatus('failed');
      setStatusDetail('This plan is still locked. The parent can claim after the unlock time.');
      return;
    }

    setActivePlanId(plan.id);
    try {
      let claimTxHash = plan.claimTxHash;
      if (!claimTxHash) {
        setStatus('building');
        setStatusDetail('Building claim transaction.');
        const claimXdr = await buildClaimGuardianBalanceXDR(publicKey, plan.claimableBalanceId);
        claimTxHash = await signAndSubmit(claimXdr);
        setPlans(updateGuardianPlan(plan.id, { claimTxHash, status: 'claimed' }));
        onChanged();
      }

      setStatus('building');
      setStatusDetail('Claim confirmed. Building one split transaction for registered wallets.');
      const splitTxHash = await signAndSubmit(
        await buildSplitPaymentXDR(publicKey, plan.totalAmount, plan.children),
      );
      setPlans(
        updateGuardianPlan(plan.id, {
          claimTxHash,
          splitTxHash,
          status: 'split_sent',
        }),
      );
      setStatus('confirmed');
      setStatusDetail('Claim and split payment confirmed.');
      await refreshPlans();
      onChanged();
    } catch (error: unknown) {
      const message = friendlyError(error, 'Claim and split failed.');
      setStatus('failed');
      if (plan.claimTxHash || message.toLowerCase().includes('spendable xlm')) {
        setStatusDetail(
          'Claim succeeded, but split payment failed. Funds are now in the parent/guardian wallet. You may retry the split payment.',
        );
        setPlans(updateGuardianPlan(plan.id, { status: 'claimed' }));
      } else {
        setStatusDetail(message);
      }
    } finally {
      setActivePlanId('');
    }
  };

  const balanceById = (balanceId?: string) =>
    claimableBalances.find((balance) => balance.id === balanceId);

  return (
    <section className="mt-6 rounded border border-gray-200 bg-white p-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Family registration + claimable balance + split payment
          </p>
          <h2 className="text-xl font-semibold text-gray-900">
            OFW Guardian Split Remittance
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">
            Demo note: family registration and split instructions are stored
            locally for this workshop MVP. The locked funds and payments happen on
            Stellar testnet.
          </p>
        </div>
        <button
          onClick={refreshPlans}
          disabled={loadingPlans || busy}
          className="min-w-40 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh plans
        </button>
      </div>

      {!publicKey && (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Connect Freighter to register family, create a plan, or claim and split funds.
        </p>
      )}

      {isOtherWallet && (
        <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          This wallet is not registered in any guardian plan. Connect the host
          or guardian wallet to continue.
        </p>
      )}

      {isHost && (
        <>
          <div className="mt-5 rounded border border-gray-200 bg-gray-50 p-4">
            <h3 className="font-medium text-gray-900">Host / OFW lock setup</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm text-gray-600">
                  Total locked amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={totalAmount}
                  onChange={(event) => {
                    const nextTotal = event.target.value;
                    setTotalAmount(nextTotal);
                    if (children.length === 1 && !children[0].amount) {
                      setChildren([{ ...children[0], amount: nextTotal }]);
                    }
                  }}
                  placeholder="0.00"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This is the amount locked in the claimable balance.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">
                  Unlock date and time
                </label>
                <input
                  type="datetime-local"
                  value={unlockAt}
                  onChange={(event) => setUnlockAt(event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Asset</label>
                <select
                  value="XLM"
                  disabled
                  className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                >
                  <option value="XLM">XLM</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  USDC is a future enhancement for this MVP.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded border border-gray-200 bg-gray-50 p-4">
            <h3 className="font-medium text-gray-900">Family Registration</h3>
            <div className="mt-4">
              <label className="mb-1 block text-sm text-gray-600">
                Parent / Guardian
              </label>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem_11rem]">
                <input
                  value={parent.publicKey}
                  onChange={(event) =>
                    setParent({
                      ...parent,
                      publicKey: event.target.value,
                      status: 'pending',
                    })
                  }
                  placeholder="G... parent wallet"
                  className="rounded border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900"
                />
                <button
                  onClick={verifyParent}
                  disabled={busy}
                  className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  Verify Wallet
                </button>
                <span
                  className={`rounded px-4 py-2 text-center text-sm ${
                    parent.status === 'confirmed'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {parent.status === 'confirmed'
                    ? 'Parent confirmed'
                    : statusPill(parent.status)}
                </span>
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-900">Wallets / Recipients</h4>
                  <p
                    className={`mt-1 text-xs ${
                      splitMatchesTotal ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    Split total: {formatAmount(splitTotalNumber)} XLM / Locked:{' '}
                    {totalAmount || '0'} XLM
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={fillSplitFromTotal}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
                  >
                    Fill split from total
                  </button>
                  <button
                    onClick={addChild}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
                  >
                    Add Wallet
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {children.map((child) => (
                  <div
                    key={child.id}
                    className="grid gap-3 rounded border border-gray-200 bg-white p-3 lg:grid-cols-[1fr_minmax(0,2fr)_9rem_12rem_7rem]"
                  >
                    <input
                      value={child.label}
                      onChange={(event) =>
                        updateChild(child.id, 'label', event.target.value)
                      }
                      placeholder="Wallet name"
                      className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    />
                    <input
                      value={child.publicKey}
                      onChange={(event) =>
                        updateChild(child.id, 'publicKey', event.target.value)
                      }
                      placeholder="G... Wallet"
                      className="rounded border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.0000001"
                      value={child.amount}
                      onChange={(event) =>
                        updateChild(child.id, 'amount', event.target.value)
                      }
                      placeholder="Amount"
                      className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                    />
                    <button
                      onClick={() => verifyChild(child.id)}
                      disabled={busy}
                      className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      Verify Wallet
                    </button>
                    <button
                      onClick={() => removeChild(child.id)}
                      disabled={children.length === 1}
                      className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                    >
                      Remove
                    </button>
                    <p
                      className={`lg:col-span-5 text-xs ${
                        child.status === 'confirmed'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {child.status === 'confirmed'
                        ? 'Wallet confirmed'
                        : statusPill(child.status)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={createPlan}
            disabled={!publicKey || busy}
            className="mt-5 w-full rounded bg-emerald-600 py-3 font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            Create claimable balance plan
          </button>
        </>
      )}

      <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-700">
          Status: {STATUS_LABEL[status]}
        </p>
        {statusDetail && <p className="mt-1 text-sm text-gray-600">{statusDetail}</p>}
      </div>

      {isGuardian && (
        <div className="mt-6">
          <h3 className="mb-3 font-medium text-gray-900">Guardian claim panel</h3>
          <div className="space-y-3">
            {guardianPlans.map((plan) => {
              const unlocked = isUnlocked(plan.unlockAt, now);
              const balance = balanceById(plan.claimableBalanceId);
              const active = activePlanId === plan.id;
              const splitSent = plan.status === 'split_sent';
              return (
                <div key={plan.id} className="rounded border border-gray-200 p-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">
                        {plan.totalAmount} XLM for {plan.children.length} wallet
                        {plan.children.length === 1 ? '' : 's'}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        Unlock: {formatDateTime(plan.unlockAt)}
                      </p>
                    </div>
                    <span
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        splitSent
                          ? 'bg-gray-100 text-gray-700'
                          : unlocked
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {splitSent ? 'Paid' : unlocked ? 'Claimable' : 'Locked'}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-gray-600">
                    {plan.children.map((child) => (
                      <p key={child.id}>
                        {child.label}: {child.amount} XLM
                      </p>
                    ))}
                  </div>
                  {renderLinks(plan)}
                  <button
                    onClick={() => claimAndSplit(plan)}
                    disabled={!unlocked || splitSent || active || busy || (!balance && !plan.claimTxHash)}
                    className={`mt-4 w-full rounded py-2 text-sm font-medium transition-colors ${
                      unlocked && !splitSent && (balance || plan.claimTxHash)
                        ? 'bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50'
                        : 'cursor-not-allowed border border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    {splitSent
                      ? 'Split payment sent'
                      : active
                        ? STATUS_LABEL[status]
                        : unlocked
                          ? 'Claim and Split Funds'
                          : `Locked until ${formatDateTime(plan.unlockAt)}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isChild && (
        <div className="mt-6">
          <h3 className="mb-3 font-medium text-gray-900">Recipient status</h3>
          <div className="space-y-3">
            {childPlans.map((plan) => {
              const child = plan.children.find(
                (currentChild) => currentChild.publicKey === publicKey,
              );
              const unlocked = isUnlocked(plan.unlockAt, now);
              return (
                <div key={plan.id} className="rounded border border-gray-200 p-4">
                  <p className="font-medium text-gray-900">
                    Assigned split amount: {child?.amount ?? '0'} XLM
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Status:{' '}
                    {plan.splitTxHash
                      ? 'Paid'
                      : unlocked
                        ? 'Parent can claim and split now'
                        : `Pending until ${formatDateTime(plan.unlockAt)}`}
                  </p>
                  {renderLinks(plan)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isHost && hostPlans.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 font-medium text-gray-900">Existing host plans</h3>
          <div className="space-y-3">
            {hostPlans.map((plan) => (
              <div key={plan.id} className="rounded border border-gray-200 p-4">
                <p className="font-medium text-gray-900">
                  {plan.totalAmount} XLM locked for {plan.parent.label}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Unlock: {formatDateTime(plan.unlockAt)}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Status: {plan.splitTxHash ? 'Split sent' : isUnlocked(plan.unlockAt, now) ? 'Claimable' : 'Locked'}
                </p>
                {renderLinks(plan)}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
