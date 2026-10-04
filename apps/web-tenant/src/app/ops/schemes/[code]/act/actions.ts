'use server';
// apps/web-tenant/src/app/ops/schemes/[code]/act/actions.ts · W2752 / W2753 · "Run eligibility sweep" — PC-56 TENANT-SW-b. A keyed
// act (the confirm page's Idempotency-Key), once per scheme per IST day (the database's UNIQUE; the API names the refusal). It
// QUEUES the sweep; the job evaluates every member and writes a call list — never an application.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { SCHEMES_DESK_HREF, failureCodes, isSchemeCode, schemeHref } from '../../../../../features/swb/console';
import { SEEN_FIELD, staleHref, verifyBeforeWrite } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';

export async function schemeActAction(formData: FormData): Promise<void> {
  const code = String(formData.get('code') ?? '');
  if (!isSchemeCode(code)) redirect(SCHEMES_DESK_HREF);
  const base = `${schemeHref(code)}/act`;
  await requireSession(base);
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let failed: string[] | null = null; let sweepId = '';
  // [PC-56 TENANT-SW-f · W318 §3] VERIFY BEFORE WRITE: the row this act's confirm step showed, re-read now — a row that moved since is
  // refused STALE_ROW with the diff (field · was · now) and nothing is written; the operator re-checks on today's row.
  const seen = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => (await tenantClient().schemes.deskPipeline(code, { limit: 1 })) as never);
  void VERIFY_FIELDS.schemeSweep;
  if (!seen.ok) redirect(staleHref(base, { act: 'sweep', reason }, seen));
  try { sweepId = (await tenantClient().schemes.runSweep(code, reason, key)).id; }
  catch (e) { failed = e instanceof SdkError ? failureCodes(e.details, e.status === 403 && !e.code ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&act=sweep&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(schemeHref(code)); revalidatePath(SCHEMES_DESK_HREF);
  redirect(`${base}?step=success&act=sweep&sweep=${sweepId}`);
}
