'use server';
// apps/web-ops/src/app/chc/maintenance/actions.ts · PC-56 OPS-4b · "Record a maintenance entry" (W408 → W3301 review → W3302 / W3303), REAL over
// `POST /v1/equipment/assets/:id/maintenance-logs` — the machine's OWNER only (MAINTENANCE_NOT_YOUR_MACHINE), Idempotency-Keyed (the key minted
// when the review was shown, so a double submit replays), not after the organisation's today (MAINTENANCE_DATE_IN_FUTURE), one audit row (the
// 4b first commit). The values are checked by PATTERN only and sent as typed; the API decides. Outcome: success → `?form=success` with the
// server's answer kept for this browser (httpOnly, path /chc/maintenance, ten minutes); the API's refusal of a field (422) → `?form=error`
// (the values kept); any other refusal → `?form=failure&reason=<named>`. The only ops4 server action; it calls no livestock write and no
// money act (source assertion, test/ops4b-pages.spec.ts).
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { SdkError, type MaintenanceEntry } from '@krishalaya/sdk-js';
import { opsClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { idParam } from '../../../features/ops4/chc';
import {
  ENTRY_COOKIE, ENTRY_COOKIE_MAX_AGE_SEC, MAINT, asRecorded, draftQuery, encodeRecorded, keyParam, maintFailureReason, parseDay, parseHours, parseLogType,
  type MaintFailure,
} from '../../../features/ops4/upkeep';

export async function recordMaintenanceAction(formData: FormData): Promise<void> {
  await requireSession(MAINT);
  const f = (k: string) => String(formData.get(k) ?? '');
  const assetId = idParam(f('asset')); const logType = parseLogType(f('logType')); const performedOn = parseDay(f('performedOn'));
  const costMinor = /^\d{1,15}$/.test(f('costMinor')) ? f('costMinor') : null; const engineHoursAt = parseHours(f('hours'));
  const key = keyParam(f('key'));
  const back = draftQuery({ asset: f('asset'), logType: f('logType'), performedOn: f('performedOn'), cost: '', hours: f('hours') });
  if (!assetId || !logType || !performedOn || !key || (f('costMinor') !== '' && !costMinor) || (f('hours') !== '' && !engineHoursAt)) redirect(`${MAINT}?form=error&reason=api&${back}`);
  let rec: MaintenanceEntry | null = null; let reason: MaintFailure | null = null; let fieldRefused = false;
  try {
    rec = await opsClient().equipment.recordMaintenance(assetId as string, { logType: logType as NonNullable<typeof logType>, performedOn: performedOn as string,
      ...(costMinor ? { costMinor } : {}), ...(engineHoursAt ? { engineHoursAt } : {}) }, key as string);
  } catch (e) {
    const r = e instanceof SdkError ? maintFailureReason(e.status, e.code) : 'record';
    if (r === null) fieldRefused = true; else reason = r;
  }
  if (fieldRefused) redirect(`${MAINT}?form=error&reason=api&${back}`);
  const kept = asRecorded(rec);
  if (!kept) redirect(`${MAINT}?form=failure&reason=${reason ?? 'record'}`);
  cookies().set(ENTRY_COOKIE, encodeRecorded(kept as NonNullable<typeof kept>),
    { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: MAINT, maxAge: ENTRY_COOKIE_MAX_AGE_SEC });
  redirect(`${MAINT}?form=success`);
}
