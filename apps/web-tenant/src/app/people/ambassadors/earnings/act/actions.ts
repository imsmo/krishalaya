'use server';
// apps/web-tenant/src/app/people/ambassadors/earnings/act/actions.ts · W2479 / W2480 · prepare · confirm · pay again · refuse the
// weekly run — PC-56 TENANT-SW-b. Re-judged by the API on the locked run and by the DATABASE (trg_apr_moves refuses the preparer
// as the checker). THE KEY IS THE CONFIRM PAGE'S (a double click pays once — and each line's wallet key is `ambrun:<run>:<amb>`
// besides). The success URL carries the run id and the counts the server returned; the reason travels only to the audit row.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { EARNINGS_ACT_HREF, EARNINGS_HREF, failureCodes, isRunAct, isUuid } from '../../../../../features/swb/console';
import { SEEN_FIELD, staleHref, verifyBeforeWrite } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';

export async function runActAction(formData: FormData): Promise<void> {
  await requireSession(EARNINGS_ACT_HREF);
  const act = String(formData.get('act') ?? '');
  const runId = String(formData.get('run') ?? '');
  if (!isRunAct(act) || (act !== 'prepare' && !isUuid(runId))) redirect(EARNINGS_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const a = tenantClient().ambassadors;
  const done = new URLSearchParams({ step: 'success', act });
  let failed: string[] | null = null;
  // [PC-56 TENANT-SW-f · W318 §3] VERIFY BEFORE WRITE: the row this act's confirm step showed, re-read now — a row that moved since is
  // refused STALE_ROW with the diff (field · was · now) and nothing is written; the operator re-checks on today's row.
  const seen = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => (act === 'prepare' ? (await a.currentRun()).run ?? {} : await a.run(runId)) as never);
  void VERIFY_FIELDS.ambassadorRun;
  if (!seen.ok) redirect(staleHref(EARNINGS_ACT_HREF, { act, run: isUuid(runId) ? runId : '', reason }, seen));
  try {
    if (act === 'prepare') { const r = await a.prepareRun(reason, key); done.set('run', r.id); done.set('lines', String(r.lineCount)); }
    else if (act === 'refuse') { await a.refuseRun(runId, reason); done.set('run', runId); }
    else {
      const r = act === 'confirm' ? await a.confirmRun(runId, reason, key) : await a.payRun(runId, reason, key);
      done.set('run', runId); done.set('paid', String(r.paid)); done.set('unfunded', String(r.unfunded)); done.set('failed', String(r.failed)); done.set('amount', r.paidMinor); done.set('status', r.status);
    }
  } catch (e) { failed = e instanceof SdkError ? failureCodes(e.details, e.status === 403 && !e.code ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed) redirect(`${EARNINGS_ACT_HREF}?step=failure&act=${act}${isUuid(runId) ? `&run=${runId}` : ''}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(EARNINGS_HREF);
  redirect(`${EARNINGS_ACT_HREF}?${done.toString()}`);
}
