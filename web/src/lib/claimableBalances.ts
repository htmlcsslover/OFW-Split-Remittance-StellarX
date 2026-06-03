import {
  Asset,
  BASE_FEE,
  Claimant,
  Horizon,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { HORIZON_URL, NETWORK_PASSPHRASE, USDC_ISSUER, server } from './stellar';
import type { AssetCode } from './payment';

const horizon = new Horizon.Server(HORIZON_URL);

interface ClaimableBalanceClaimant {
  destination: string;
  predicate: {
    not?: {
      abs_before?: string | number;
    };
  };
}

export interface GuardianClaimableBalance {
  id: string;
  asset: string;
  amount: string;
  claimants: ClaimableBalanceClaimant[];
  unlockAt: Date | null;
  claimableNow: boolean;
}

export interface CreateGuardianBalanceInput {
  source: string;
  beneficiary: string;
  amount: string;
  unlockAt: Date;
  assetCode: AssetCode;
}

function getAsset(assetCode: AssetCode): Asset {
  if (assetCode === 'XLM') return Asset.native();
  if (!USDC_ISSUER) {
    throw new Error('USDC is not configured for this workshop app.');
  }
  return new Asset('USDC', USDC_ISSUER);
}

export function validatePublicKey(value: string, label: string): string {
  const publicKey = value.trim();
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error(`${label} must be a valid Stellar public address.`);
  }
  return publicKey;
}

export function validatePositiveAmount(value: string): string {
  const amount = value.trim();
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Amount must be greater than 0.');
  }
  return amount;
}

export function validateFutureUnlock(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new Error('Choose a valid unlock date and time.');
  }
  if (value.getTime() <= Date.now()) {
    throw new Error('Unlock time must be in the future.');
  }
  return value;
}

export async function buildCreateGuardianBalanceXDR({
  source,
  beneficiary,
  amount,
  unlockAt,
  assetCode,
}: CreateGuardianBalanceInput): Promise<string> {
  const sourceAddress = validatePublicKey(source, 'Connected wallet');
  const beneficiaryAddress = validatePublicKey(beneficiary, 'Beneficiary address');
  const validAmount = validatePositiveAmount(amount);
  const validUnlockAt = validateFutureUnlock(unlockAt);
  const unlockSeconds = Math.floor(validUnlockAt.getTime() / 1000).toString();

  const account = await server.getAccount(sourceAddress);
  const claimant = new Claimant(
    beneficiaryAddress,
    Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(unlockSeconds)),
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createClaimableBalance({
        asset: getAsset(assetCode),
        amount: validAmount,
        claimants: [claimant],
      }),
    )
    .setTimeout(60)
    .build();

  return tx.toXDR();
}

export async function buildClaimGuardianBalanceXDR(
  claimantAddress: string,
  balanceId: string,
): Promise<string> {
  const claimant = validatePublicKey(claimantAddress, 'Connected wallet');
  const account = await server.getAccount(claimant);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.claimClaimableBalance({ balanceId }))
    .setTimeout(60)
    .build();

  return tx.toXDR();
}

function readUnlockAt(
  claimants: ClaimableBalanceClaimant[],
  claimantAddress: string,
): Date | null {
  const matchingClaimant = claimants.find((c) => c.destination === claimantAddress);
  const unlockValue = matchingClaimant?.predicate.not?.abs_before;
  if (!unlockValue) return null;

  const numericValue = Number(unlockValue);
  if (Number.isFinite(numericValue)) {
    const millis = numericValue * 1000;
    return new Date(millis);
  }

  const millis = Date.parse(String(unlockValue));
  if (Number.isNaN(millis)) return null;
  return new Date(millis);
}

function isClaimableAtUnlockTime(unlockAt: Date | null): boolean {
  return Boolean(unlockAt && unlockAt.getTime() <= Date.now());
}

export async function fetchClaimableBalancesForClaimant(
  claimantAddress: string,
): Promise<GuardianClaimableBalance[]> {
  const claimant = validatePublicKey(claimantAddress, 'Connected wallet');
  const page = await horizon
    .claimableBalances()
    .claimant(claimant)
    .order('desc')
    .limit(20)
    .call();

  return page.records.map((record) => {
    const unlockAt = readUnlockAt(record.claimants, claimant);
    return {
      id: record.id,
      asset: record.asset === 'native' ? 'XLM' : record.asset,
      amount: record.amount,
      claimants: record.claimants,
      unlockAt,
      claimableNow: isClaimableAtUnlockTime(unlockAt),
    };
  });
}

export async function fetchClaimableBalancesSponsoredBy(
  sponsorAddress: string,
): Promise<GuardianClaimableBalance[]> {
  const sponsor = validatePublicKey(sponsorAddress, 'Connected wallet');
  const page = await horizon
    .claimableBalances()
    .sponsor(sponsor)
    .order('desc')
    .limit(20)
    .call();

  return page.records.map((record) => {
    const firstClaimant = record.claimants[0]?.destination ?? '';
    const unlockAt = firstClaimant ? readUnlockAt(record.claimants, firstClaimant) : null;
    return {
      id: record.id,
      asset: record.asset === 'native' ? 'XLM' : record.asset,
      amount: record.amount,
      claimants: record.claimants,
      unlockAt,
      claimableNow: isClaimableAtUnlockTime(unlockAt),
    };
  });
}

export async function fetchClaimableBalanceById(
  balanceId: string,
): Promise<GuardianClaimableBalance | null> {
  try {
    const record = await horizon.claimableBalances().claimableBalance(balanceId).call();
    const firstClaimant = record.claimants[0]?.destination ?? '';
    const unlockAt = firstClaimant ? readUnlockAt(record.claimants, firstClaimant) : null;
    return {
      id: record.id,
      asset: record.asset === 'native' ? 'XLM' : record.asset,
      amount: record.amount,
      claimants: record.claimants,
      unlockAt,
      claimableNow: isClaimableAtUnlockTime(unlockAt),
    };
  } catch (error: unknown) {
    console.error('Error fetching claimable balance:', error);
    return null;
  }
}
