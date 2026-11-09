'use server';
// apps/web-ops/src/app/bmc/actions.ts · PC-56 OPS-3b · THE MANUAL READING (W366 "Log manual reading" → W3283 review → W3284 / W3285), REAL over the
// EXISTING `POST /v1/dairy/bmc/readings {unitId,tempC}` (dairy.collect or dairy.manage; no key — a series of readings is append-only, the API's own
// rule). The temperature is checked by PATTERN only and sent as typed; NO `recordedAt` is sent (the SDK sends the four accepted keys only, OPS3-B17):
// the SERVER records the time. Custody is decided by the API (L1): a counter person without custody of the cooler's centre is refused by name.
// Outcome: success → `/bmc?form=success` with the server's answer kept for this browser (httpOnly, path /bmc, ten minutes); the API's refusal of
// the value → `/bmc?form=error` (W3282, the typed value kept); any other refusal → `/bmc?form=failure&reason=<named>` (W3285).
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { SdkError, type DairyBmcReading } from '@krishalaya/sdk-js';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { BMC, READING_COOKIE, READING_COOKIE_MAX_AGE_SEC, encodeReading, parseTemp, parseUnit, readingFailureReason, typedTemp, type ReadingReason } from '../../features/ops3/bmc';

export async function recordBmcReadingAction(formData: FormData): Promise<void> {
  await requireSession(BMC);
  const unit = parseUnit(String(formData.get('unit') ?? ''));
  const typed = typedTemp(String(formData.get('tempC') ?? ''));
  const tempC = parseTemp(typed);
  if (!unit) redirect(`${BMC}?form=error&reason=unit`);
  if (!tempC) redirect(`${BMC}?form=error&reason=temp&unit=${unit}&value=${encodeURIComponent(typed)}`);
  let rec: DairyBmcReading | null = null; let reason: ReadingReason | null = null; let valueRefused = false;
  try { rec = await opsClient().dairy.recordBmcReading({ unitId: unit, tempC }); }
  catch (e) {
    const r = e instanceof SdkError ? readingFailureReason(e.status, e.code, e.details as Record<string, unknown> | undefined) : 'record';
    if (r === null) valueRefused = true; else reason = r;
  }
  if (valueRefused) redirect(`${BMC}?form=error&reason=temp&unit=${unit}&value=${encodeURIComponent(typed)}`);
  if (!rec) redirect(`${BMC}?form=failure&reason=${reason ?? 'record'}&unit=${unit}`);
  cookies().set(READING_COOKIE, encodeReading({ unitId: rec.unitId, tempC: rec.tempC, verdict: rec.verdict, recordedAt: String(rec.recordedAt), band: rec.band }),
    { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: BMC, maxAge: READING_COOKIE_MAX_AGE_SEC });
  redirect(`${BMC}?form=success&unit=${rec.unitId}`);
}
