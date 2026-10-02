'use server';
// apps/web-tenant/src/app/governance/resolutions/[id]/act/actions.ts · W2746 / W2747 · open · close · withdraw — PC-56
// TENANT-9b. Re-judged by the API on the locked row. THE KEY IS THE CONFIRM PAGE'S. The note never travels into a success
// URL (it is on the audit row); a close's success carries the OUTCOME the database wrote.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { RESOLUTIONS_HREF, isResolutionAct, refusalCodesFrom } from '../../../../../features/governance/resolutions';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function resolutionActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const actRaw = String(formData.get('act') ?? '');
  const base = `${RESOLUTIONS_HREF}/${encodeURIComponent(id)}/act`;
  await requireSession(base);
  if (!isResolutionAct(actRaw)) redirect(`${base}?step=failure&error=unknown`);
  const act = actRaw as 'open' | 'close' | 'withdraw';
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const reasonCode = opt(formData.get('reasonCode'));
  const note = opt(formData.get('note'));
  let outcome: string | null = null; let failed: string[] | null = null;
  try {
    outcome = (await tenantClient().memberships.resolutionAct(id, act, { reasonCode, note }, key)).outcome;
  } catch (e) { failed = e instanceof SdkError ? refusalCodesFrom(e.details, e.code || 'unknown') : ['unknown']; }
  const keep = new URLSearchParams({ act }); if (reasonCode) keep.set('reasonCode', reasonCode);
  if (failed) redirect(`${base}?step=failure&${keep.toString()}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(RESOLUTIONS_HREF);
  const done = new URLSearchParams({ step: 'success', act });
  if (outcome) done.set('outcome', outcome);
  redirect(`${base}?${done.toString()}`);
}
