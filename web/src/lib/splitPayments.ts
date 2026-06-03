import {
  Asset,
  BASE_FEE,
  Horizon,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { HORIZON_URL, NETWORK_PASSPHRASE, server } from './stellar';
import type { GuardianChild } from './guardianPlans';

const horizon = new Horizon.Server(HORIZON_URL);
const STROOPS_PER_XLM = BigInt(10_000_000);

function amountToStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new Error('Amounts must be positive numbers with up to 7 decimals.');
  }

  const [whole, fraction = ''] = trimmed.split('.');
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, '0'));
}

function stroopsToAmount(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = (stroops % STROOPS_PER_XLM).toString().padStart(7, '0');
  return `${whole}.${fraction}`.replace(/\.?0+$/, '');
}

export function validateSplitRecipients(
  totalAmount: string,
  recipients: GuardianChild[],
): void {
  if (recipients.length === 0) {
    throw new Error('Add at least one family recipient.');
  }

  let sum = BigInt(0);
  for (const [index, recipient] of recipients.entries()) {
    const label = recipient.label.trim() || `Recipient ${index + 1}`;
    if (recipient.status !== 'confirmed') {
      throw new Error(`${label} must be confirmed before creating a plan.`);
    }
    if (!StrKey.isValidEd25519PublicKey(recipient.publicKey.trim())) {
      throw new Error(`${label} must have a valid Stellar public key.`);
    }
    const amount = amountToStroops(recipient.amount);
    if (amount <= BigInt(0)) {
      throw new Error(`${label} amount must be greater than 0.`);
    }
    sum += amount;
  }

  const total = amountToStroops(totalAmount);
  if (total <= BigInt(0)) {
    throw new Error('Total locked amount must be greater than 0.');
  }
  if (sum !== total) {
    throw new Error(
      `Recipient amounts must equal total locked amount (${stroopsToAmount(total)} XLM).`,
    );
  }
}

async function assertEnoughSpendableXlm(
  sender: string,
  totalAmount: string,
  operationCount: number,
): Promise<void> {
  const account = await horizon.loadAccount(sender);
  const nativeBalance = account.balances.find((balance) => balance.asset_type === 'native');
  const balance = amountToStroops(nativeBalance?.balance ?? '0');
  const total = amountToStroops(totalAmount);
  const minReserve = BigInt(account.subentry_count + 2) * BigInt(5_000_000);
  const feeBuffer = BigInt(operationCount + 1) * BigInt(BASE_FEE);
  const spendable = balance - minReserve - feeBuffer;

  if (spendable < total) {
    throw new Error(
      'The guardian wallet does not have enough spendable XLM after minimum reserve and fees. Claim succeeded, but split payment cannot be sent yet.',
    );
  }
}

export async function buildSplitPaymentXDR(
  sender: string,
  totalAmount: string,
  recipients: GuardianChild[],
): Promise<string> {
  if (!StrKey.isValidEd25519PublicKey(sender)) {
    throw new Error('Connected guardian wallet is not a valid Stellar address.');
  }

  validateSplitRecipients(totalAmount, recipients);
  await assertEnoughSpendableXlm(sender, totalAmount, recipients.length);

  const account = await server.getAccount(sender);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  for (const recipient of recipients) {
    builder.addOperation(
      Operation.payment({
        destination: recipient.publicKey.trim(),
        asset: Asset.native(),
        amount: recipient.amount.trim(),
      }),
    );
  }

  return builder.setTimeout(60).build().toXDR();
}
