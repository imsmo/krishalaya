'use server';
// apps/web-tenant/src/app/payouts/actions.ts · the tenant's money-OUT mutations. The only place the authed
// tenantClient() writes for the payouts path. Two Server Actions:
//   - requestPayoutAction: payouts.request({ amountMinor, bankAccountId }, Idempotency-Key) — a withdrawal from
//     the wallet to a tokenised destination. The Idempotency-Key (Law 3) means a double-submit can't double-pay.
//     Money is parsed float-free (Law 2). The API enforces balance + destination ownership server-side.
//   - addBankAccountAction: bankAccounts.add({ vaultRef, … }, Idempotency-Key). vaultRef is the GATEWAY-tokenised
//     fund-account id; raw account numbers / VPAs are tokenised at the gateway out-of-band and never touch us.
// 'use server' modules export ONLY async functions — validation/types live in features/payouts/form.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildPayoutRequest, buildBankAccount } from '../../features/payouts/form';
import { SdkError } from '@krishalaya/sdk-js';

function back(qs: string): never { redirect(`/payouts?${qs}`); }

export async function requestPayoutAction(formData: FormData): Promise<void> {
  await requireSession('/payouts');
  const built = buildPayoutRequest({ amountMajor: String(formData.get('amountMajor') ?? ''), bankAccountId: String(formData.get('bankAccountId') ?? '') });
  if (!built.ok) back(`error=${built.error}`);
  try {
    await tenantClient().payouts.request(built.value, randomUUID());
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'PAYOUT_FAILED') : 'PAYOUT_FAILED';
    back(`error=${encodeURIComponent(code === 'PAYOUT_FAILED' ? 'payout' : code)}`);
  }
  revalidatePath('/payouts');
  back('ok=requested');
}

export async function addBankAccountAction(formData: FormData): Promise<void> {
  await requireSession('/payouts');
  const built = buildBankAccount({
    accountKind: String(formData.get('accountKind') ?? ''),
    vaultRef: String(formData.get('vaultRef') ?? ''),
    upiId: String(formData.get('upiId') ?? ''),
    accountLast4: String(formData.get('accountLast4') ?? ''),
    ifsc: String(formData.get('ifsc') ?? ''),
    holderName: String(formData.get('holderName') ?? ''),
    isPrimary: String(formData.get('isPrimary') ?? ''),
  });
  if (!built.ok) back(`error=bank_${built.error}`);
  try {
    await tenantClient().bankAccounts.add(built.value, randomUUID());
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'BANK_FAILED') : 'BANK_FAILED';
    back(`error=${encodeURIComponent(code === 'BANK_FAILED' ? 'bank_failed' : code)}`);
  }
  revalidatePath('/payouts');
  back('ok=bank_added');
}
