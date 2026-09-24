'use server';
// apps/web-tenant/src/app/studio/earnings/agreement/actions.ts · the agreement's acts — PC-56 TENANT-7d-money.
// `offer` (the desk, for an instructor, at the rule in force or a negotiated share) · `accept` / `decline` (the instructor,
// their own) · `supersede` (the desk). Each under a fresh Idempotency-Key; the server re-takes the verdict on the locked
// row and 0174's trigger says the same at the wall. Acceptance releases every held line — the success screen prints the
// API's own release figures, computed nowhere else.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';
import { AGREEMENT_PATH, EARNINGS_PATH, agreementChainAct, percentToBps } from '../../../../features/studio/earnings';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function agreementAction(formData: FormData): Promise<void> {
  const act = agreementChainAct(opt(formData.get('act')));
  const agreement = opt(formData.get('agreement'));
  const instructor = opt(formData.get('instructor'));
  const shareBps = opt(formData.get('shareBps'));
  const termsNote = opt(formData.get('termsNote'));
  await requireSession(AGREEMENT_PATH);
  const values = { act: act ?? '', agreement, instructor, shareBps, termsNote };
  if (!act || (act === 'offer' ? !instructor : !agreement)) redirect(`${AGREEMENT_PATH}?${carryValues('confirm', values).query}`);
  let released = '';
  try {
    if (act === 'offer') {
      const bps = shareBps ? percentToBps(shareBps) : null;
      const a = await tenantClient().instructorEarnings.offerAgreement({ instructorId: instructor as string, instructorShareBps: bps, termsNote: termsNote ?? null }, randomUUID());
      values.agreement = a.id;
    } else {
      const r = await tenantClient().instructorEarnings.actAgreement(agreement as string, act, randomUUID());
      released = r.released.map((x) => `${x.currencyCode}:${x.amountMinor}:${x.lines}`).join(',');
    }
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'agreement') : 'agreement';
    const detail = e instanceof SdkError && Array.isArray(e.details?.refusals) ? (e.details!.refusals as string[]).join(',') : '';
    redirect(`${AGREEMENT_PATH}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}${detail ? `&refusals=${encodeURIComponent(detail)}` : ''}`);
  }
  revalidatePath(EARNINGS_PATH);
  const sp = new URLSearchParams({ step: 'success', act });
  if (values.agreement) sp.set('agreement', values.agreement);
  if (instructor) sp.set('instructor', instructor);
  if (released) sp.set('released', released);
  redirect(`${AGREEMENT_PATH}?${sp.toString()}`);
}
