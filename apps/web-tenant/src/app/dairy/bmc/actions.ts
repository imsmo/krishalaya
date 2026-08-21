'use server';
// apps/web-tenant/src/app/dairy/bmc/actions.ts · W170's acts — PC-56 TENANT-6d-1.
//
// The first writes `bmc_units` has ever had. Every one goes through the SDK to the audited, `dairy.manage`-gated,
// `dairy_bmc_monitor`-flagged API, which re-validates with zod `.strict()`, keeps temperatures as one-decimal strings
// end to end, and computes a breach from the TANK's band rather than from anything a caller says.
//
// Register and level carry a fresh Idempotency-Key (Law 3). Band, compressor and retire do not: each is a
// last-write-wins statement about the present, and a replayed "the compressor is fine" is the same fact.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/dairy/bmc';
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

function fail(e: unknown, unitId?: string): never {
  const q = new URLSearchParams({ error: e instanceof SdkError ? (e.code || 'save') : 'save' });
  if (unitId) q.set('unit', unitId);
  redirect(`${PATH}?${q.toString()}`);
}

/** W170's *"No BMC units → Add BMC"*. */
export async function registerBmcAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const mccId = String(formData.get('mccId') ?? '').trim();
  const capacityLitres = String(formData.get('capacityLitres') ?? '').trim();
  if (!mccId) redirect(`${PATH}?error=mcc`);
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(capacityLitres)) redirect(`${PATH}?error=capacity`);
  try {
    await tenantClient().dairy.registerBmcUnit({
      mccId, capacityLitres,
      targetTempC: opt(formData.get('targetTempC')), minTempC: opt(formData.get('minTempC')),
      toleranceC: opt(formData.get('toleranceC')), iotDeviceRef: opt(formData.get('iotDeviceRef')),
      model: opt(formData.get('model')), serialNo: opt(formData.get('serialNo')),
    }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=registered`);
}

/** What "cold enough" means for this tank — the decision the whole screen is judged against. */
export async function setBmcBandAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('unitId') ?? '').trim();
  const minTempC = String(formData.get('minTempC') ?? '').trim();
  const targetTempC = String(formData.get('targetTempC') ?? '').trim();
  const toleranceC = String(formData.get('toleranceC') ?? '').trim();
  if (!id) redirect(`${PATH}?error=unit`);
  for (const v of [minTempC, targetTempC]) if (!/^-?\d{1,3}(\.\d)?$/.test(v)) fail(new Error('band'), id);
  if (!/^\d(\.\d)?$/.test(toleranceC)) fail(new Error('band'), id);
  try { await tenantClient().dairy.setBmcBand(id, { minTempC, targetTempC, toleranceC }); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${PATH}?unit=${encodeURIComponent(id)}&ok=band`);
}

/** *"41% full"* — a level, with who reported it. */
export async function reportBmcLevelAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('unitId') ?? '').trim();
  const volumeLitres = String(formData.get('volumeLitres') ?? '').trim();
  if (!id) redirect(`${PATH}?error=unit`);
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(volumeLitres)) fail(new Error('volume'), id);
  try { await tenantClient().dairy.reportBmcLevel(id, { volumeLitres }, randomUUID()); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${PATH}?unit=${encodeURIComponent(id)}&ok=level`);
}

/** Somebody's word about the machine. The screen never infers this from the milk being cold. */
export async function stateBmcCompressorAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('unitId') ?? '').trim();
  const state = String(formData.get('state') ?? '').trim();
  if (!id) redirect(`${PATH}?error=unit`);
  if (!['healthy', 'attention', 'unknown'].includes(state)) fail(new Error('state'), id);
  try { await tenantClient().dairy.stateBmcCompressor(id, { state: state as 'healthy' | 'attention' | 'unknown' }); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${PATH}?unit=${encodeURIComponent(id)}&ok=compressor`);
}

/** The cooler is gone. Its readings stay exactly where they are; the monitor stops watching. */
export async function retireBmcAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('unitId') ?? '').trim();
  if (!id) redirect(`${PATH}?error=unit`);
  try { await tenantClient().dairy.retireBmcUnit(id); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=retired`);
}

/**
 * A reading, typed in by hand.
 *
 * The stream a sensor uses is the same route; this exists because W170's own empty state admits half these tanks are
 * read with a thermometer and a notebook, and a monitor that only accepts IoT would leave those cooperatives with a
 * screen full of `no readings`.
 */
export async function recordBmcReadingAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('unitId') ?? '').trim();
  const tempC = String(formData.get('tempC') ?? '').trim();
  if (!id) redirect(`${PATH}?error=unit`);
  if (!/^-?\d{1,3}(\.\d)?$/.test(tempC)) fail(new Error('temp'), id);
  try { await tenantClient().dairy.recordBmcReading({ unitId: id, tempC }); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${PATH}?unit=${encodeURIComponent(id)}&ok=reading`);
}
