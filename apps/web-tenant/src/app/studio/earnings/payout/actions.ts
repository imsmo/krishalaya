'use server';
// apps/web-tenant/src/app/studio/earnings/payout/actions.ts · the royalty payout request — PC-56 TENANT-7d-money.
// Posts the request the API reviewed (amount in MINOR units, currency, bank account) under a fresh Idempotency-Key. The
// request itself is the payment plane's (`purpose course_royalty`); the money leaves only through the tenant's approved
// batch. The amount travels to the success URL only as the plane's own payout id.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';
import { EARNINGS_PATH, PAYOUT_PATH } from '../../../../features/studio/earnings';

export async function requestRoyaltyPayoutAction(formData: FormData): Promise<void> {
  const amountMinor = String(formData.get('amountMinor') ?? '').trim();
  const currencyCode = String(formData.get('currencyCode') ?? '').trim();
  const bankAccountId = String(formData.get('bankAccountId') ?? '').trim();
  await requireSession(PAYOUT_PATH);
  const values = { amountMinor, currencyCode, bankAccountId };
  if (!/^[1-9]\d{0,15}$/.test(amountMinor) || !/^[A-Z]{3}$/.test(currencyCode) || !bankAccountId) redirect(`${PAYOUT_PATH}?${carryValues('confirm', values).query}`);
  let payoutId: string;
  try { payoutId = (await tenantClient().instructorEarnings.requestPayout({ amountMinor, currencyCode, bankAccountId }, randomUUID())).payoutId; }
  catch (e) {
    const code = e instanceof SdkError ? (e.code || 'payout') : 'payout';
    const detail = e instanceof SdkError && Array.isArray(e.details?.refusals) ? (e.details!.refusals as string[]).join(',') : '';
    redirect(`${PAYOUT_PATH}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}${detail ? `&refusals=${encodeURIComponent(detail)}` : ''}`);
  }
  revalidatePath(EARNINGS_PATH);
  redirect(`${PAYOUT_PATH}?step=success&payout=${encodeURIComponent(payoutId)}&currencyCode=${encodeURIComponent(currencyCode)}`);
}
