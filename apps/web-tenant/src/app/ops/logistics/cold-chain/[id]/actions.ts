'use server';
// apps/web-tenant/src/app/ops/logistics/cold-chain/[id]/actions.ts · W239 — a MANUAL reading (temperature only: no band, no time — the
// API refuses both by name; the band is copied from the store, the time is the server's) and the trail export (W2534) · PC-56 TENANT-SW-e.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { coldExportHref, coldSubjectHref, isColdSubjectType, isUuid } from '../../../../../features/swe/console';

const code = (e: unknown) => (e instanceof SdkError ? (e.code || 'unknown') : 'unknown');

export async function recordManualReadingAction(formData: FormData): Promise<void> {
  const type = String(formData.get('subjectType') ?? ''); const id = String(formData.get('subjectId') ?? '');
  if (!isColdSubjectType(type) || !isUuid(id)) redirect('/ops/logistics/cold-chain');
  const back = coldSubjectHref(type, id);
  await requireSession(back);
  const temp = Number(String(formData.get('tempC') ?? '').trim());
  const hum = String(formData.get('humidityPct') ?? '').trim();
  if (!Number.isFinite(temp)) redirect(`${back}&error=COLD_CHAIN_READING_INVALID`);
  try { await tenantClient().coldChain.recordReading({ subjectType: type, subjectId: id, tempC: temp, humidityPct: hum ? Number(hum) : null }); }
  catch (e) { redirect(`${back}&error=${encodeURIComponent(code(e))}`); }
  revalidatePath(back);
  redirect(`${back}&recorded=1`);
}

export async function exportTrailAction(formData: FormData): Promise<void> {
  const type = String(formData.get('subjectType') ?? ''); const id = String(formData.get('subjectId') ?? '');
  const days = Math.min(730, Math.max(1, Number(formData.get('days') ?? 30) || 30));
  if (!isColdSubjectType(type) || !isUuid(id)) redirect('/ops/logistics/cold-chain');
  const back = coldSubjectHref(type, id);
  await requireSession(back);
  let jobId = '';
  try { jobId = (await tenantClient().coldChain.exportTrail({ subjectType: type, subjectId: id, days }, String(formData.get('idempotencyKey') || randomUUID()))).id; }
  catch (e) { redirect(`${back}&error=${encodeURIComponent(code(e))}`); }
  redirect(coldExportHref(jobId));
}
