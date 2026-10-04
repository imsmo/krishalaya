'use server';
// apps/web-tenant/src/app/ops/logistics/cod/act/actions.ts · W243 — the COD MUTATE chain's writes (PC-56 TENANT-SW-a): open today's cash
// day, close it (checker; carries with reasons), collect a shortfall (deposit reference). Keyed by the confirm page's idempotency key.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { COD_HREF, closeCarries, isCodAct, isUuid, isYmd } from '../../../../../features/swa/console';
import { SEEN_FIELD, staleHref, verifyBeforeWrite } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';

export async function codActAction(formData: FormData): Promise<void> {
  const base = `${COD_HREF}/act`;
  await requireSession(base);
  const q: Record<string, string> = {}; formData.forEach((v, k) => { if (typeof v === 'string') q[k] = v; });
  const act = q.act ?? ''; const id = q.id ?? ''; const date = q.date ?? '';
  const note = (q.note ?? '').trim(); const depositRef = (q.depositRef ?? '').trim(); const key = q.idempotencyKey ?? '';
  if (!isCodAct(act) || (act === 'closeDay' && !isYmd(date)) || (act === 'collectShortfall' && !isUuid(id))) redirect(COD_HREF);
  const carry = new URLSearchParams({ act, ...(isUuid(id) ? { id } : {}), ...(isYmd(date) ? { date } : {}), ...(note ? { note } : {}), ...(depositRef ? { depositRef } : {}) });
  let auditId = '';
  // [PC-56 TENANT-SW-f · W318 §3] VERIFY BEFORE WRITE: the row this act's confirm step showed, re-read now — a row that moved since is
  // refused STALE_ROW with the diff (field · was · now) and nothing is written; the operator re-checks on today's row.
  const seen = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => (act === 'collectShortfall' ? (await tenantClient().shipments.codShortfalls({ status: 'open', limit: 100 })).items.find((s) => s.id === id) ?? null : await (async () => { const b = await tenantClient().shipments.codBoard(); return b.days.find((d) => d.businessDate === (date || b.today)) ?? {}; })()) as never);
  void VERIFY_FIELDS.codShortfall;
  if (!seen.ok) redirect(staleHref(base, Object.fromEntries(carry), seen));
  try {
    const s = tenantClient().shipments;
    if (act === 'openDay') auditId = (await s.openCashDay(key)).id;
    else if (act === 'closeDay') {
      const ids = (q.carryIds ?? '').split(',').filter(isUuid);
      const { carries } = closeCarries(ids, q);
      auditId = (await s.closeCashDay(date, { carries, ...(note ? { note } : {}) }, key)).day.id;
    } else {
      auditId = (await s.collectCodShortfall(id, { depositRef, ...(note ? { note } : {}) }, key)).id;
    }
  } catch (e) {
    carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'generic') : 'generic'); redirect(`${base}?${carry.toString()}`);
  }
  revalidatePath(COD_HREF);
  carry.set('step', 'success'); carry.set('auditId', auditId);
  redirect(`${base}?${carry.toString()}`);
}
