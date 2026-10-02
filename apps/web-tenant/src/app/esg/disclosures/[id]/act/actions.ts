'use server';
// apps/web-tenant/src/app/esg/disclosures/[id]/act/actions.ts · W2603 / W2604 · publish · withdraw — PC-56 TENANT-9d.
// Re-judged by the API on the locked row. THE KEY IS THE CONFIRM PAGE'S. The note never travels into a success URL (it is the
// audit row's reason).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { refusalCodesFrom } from '../../../../../features/governance/resolutions';
import { ESG_HREF, isDisclosureAct } from '../../../../../features/esg/esg';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function disclosureActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const actRaw = String(formData.get('act') ?? '');
  const base = `${ESG_HREF}/disclosures/${encodeURIComponent(id)}/act`;
  await requireSession(base);
  if (!isDisclosureAct(actRaw)) redirect(`${base}?step=failure&error=unknown`);
  const act = actRaw as 'publish' | 'withdraw';
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const reasonCode = opt(formData.get('reasonCode'));
  const note = opt(formData.get('note'));
  let failed: string[] | null = null;
  try { await tenantClient().esg.disclosureAct(id, act, { reasonCode, note }, key); }
  catch (e) { failed = e instanceof SdkError ? refusalCodesFrom(e.details, e.code || 'unknown') : ['unknown']; }
  const keep = new URLSearchParams({ act }); if (reasonCode) keep.set('reasonCode', reasonCode);
  if (failed) redirect(`${base}?step=failure&${keep.toString()}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(ESG_HREF);
  redirect(`${base}?step=success&act=${act}`);
}
