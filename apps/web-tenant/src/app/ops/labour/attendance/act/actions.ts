'use server';
// apps/web-tenant/src/app/ops/labour/attendance/act/actions.ts · W2496 / W2497 · vouch · refuse · confirm · confirm all clean ·
// paper backfill — PC-56 TENANT-SW-b. Re-judged by the API and by the DATABASE (trg_attendance_review: the worker never confirms
// or vouches their own day; a needs-review day is never confirmed without a vouch; a backfill's recorder never vouches for it).
// The confirm / confirm-all / backfill Idempotency-Key is the confirm page's. Only codes and counts travel in the success URL.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { ATTENDANCE_ACT_HREF, ATTENDANCE_HREF, failureCodes, hoursFrom, isAttAct, isUuid, ymdFrom } from '../../../../../features/swb/console';
import { SEEN_FIELD, staleHref, verifyBeforeWrite } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';

export async function attendanceActAction(formData: FormData): Promise<void> {
  await requireSession(ATTENDANCE_ACT_HREF);
  const act = String(formData.get('act') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!isAttAct(act)) redirect(ATTENDANCE_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const c = tenantClient().labour;
  const done = new URLSearchParams({ step: 'success', act });
  let failed: string[] | null = null;
  // [PC-56 TENANT-SW-f · W318 §3] VERIFY BEFORE WRITE: the row this act's confirm step showed, re-read now — a row that moved since is
  // refused STALE_ROW with the diff (field · was · now) and nothing is written; the operator re-checks on today's row.
  const seen = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => (act === 'backfill' ? {} : await c.attendanceSummary()) as never);
  void VERIFY_FIELDS.attendanceTiles;
  if (!seen.ok) redirect(staleHref(ATTENDANCE_ACT_HREF, { act, id: isUuid(id) ? id : '', reason }, seen));
  try {
    if ((act === 'vouch' || act === 'refuse' || act === 'confirm') && !isUuid(id)) failed = ['ATTENDANCE_NOT_FOUND'];
    else if (act === 'vouch' || act === 'refuse') { await c.reviewAttendance(id, act, reason); done.set('id', id); }
    else if (act === 'confirm') { await c.confirmAttendanceDay(id, reason || undefined, key); done.set('id', id); }
    else if (act === 'confirm_clean') { const r = await c.confirmAllClean(reason || undefined, key); done.set('n', String(r.confirmed)); done.set('skipped', String(r.skippedOwn)); done.set('considered', String(r.considered)); }
    else {
      const assignmentId = String(formData.get('assignmentId') ?? ''); const workDate = ymdFrom(String(formData.get('workDate') ?? ''));
      const hoursRegular = hoursFrom(String(formData.get('hoursRegular') ?? ''), 0.5, 12); const hoursOvertime = hoursFrom(String(formData.get('hoursOvertime') ?? '0') || '0', 0, 8);
      const mediaId = String(formData.get('mediaId') ?? '').trim();
      if (!isUuid(assignmentId) || !workDate || hoursRegular === null || hoursOvertime === null || !isUuid(mediaId)) failed = ['VALIDATION_FAILED'];
      else { const r = await c.backfillAttendance({ assignmentId, workDate, hoursRegular, hoursOvertime, mediaId, reason }, key); done.set('id', r.id); }
    }
  } catch (e) { failed = e instanceof SdkError ? failureCodes(e.details, e.status === 403 && !e.code ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed) redirect(`${ATTENDANCE_ACT_HREF}?step=failure&act=${act}${isUuid(id) ? `&id=${id}` : ''}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(ATTENDANCE_HREF);
  redirect(`${ATTENDANCE_ACT_HREF}?${done.toString()}`);
}
