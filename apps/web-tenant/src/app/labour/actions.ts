'use server';
// apps/web-tenant/src/app/labour/actions.ts · labour employer-admin mutations. Every write goes through the SDK to
// the audited, RBAC-gated (`worker.book` / `booking.manage`) + `labour`-flagged API, which snapshots the statutory
// min-wage and REJECTS an offer below it (422 — never client-supplied), enforces the booking/assignment state
// machines, and moves wages SERVER-SIDE through the wallet ledger (Law 2/11). Create/assign/pay/confirm carry a
// fresh Idempotency-Key (Law 3). 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { validateBookingForm, validateAssignWage } from '../../features/labour/employer';

const PATH = '/labour';
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

function fail(e: unknown): never {
  redirect(`${PATH}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
}

export async function createBookingAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const input = {
    demandTypeCode: String(formData.get('demandTypeCode') ?? '').trim(),
    taskSkillId: String(formData.get('taskSkillId') ?? '').trim(),
    regionId: String(formData.get('regionId') ?? '').trim(),
    skillLevel: String(formData.get('skillLevel') ?? '').trim(),
    workersNeeded: Number(formData.get('workersNeeded') ?? 0),
    startDate: String(formData.get('startDate') ?? '').trim(),
    endDate: String(formData.get('endDate') ?? '').trim(),
    wageKind: String(formData.get('wageKind') ?? 'per_day').trim(),
    wageOfferedMinor: String(formData.get('wageOfferedMinor') ?? '').trim(),
    farmLat: Number(formData.get('farmLat') ?? NaN),
    farmLng: Number(formData.get('farmLng') ?? NaN),
    dailyHours: formData.get('dailyHours') != null && String(formData.get('dailyHours')).trim() !== '' ? Number(formData.get('dailyHours')) : undefined,
  };
  const bad = validateBookingForm(input);
  if (bad) redirect(`${PATH}?error=${bad}`);
  try {
    await tenantClient().labour.createBooking({
      demandTypeCode: input.demandTypeCode, taskSkillId: input.taskSkillId, regionId: input.regionId,
      skillLevel: input.skillLevel as 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled',
      workersNeeded: input.workersNeeded, startDate: input.startDate, endDate: input.endDate,
      wageKind: input.wageKind as 'per_day' | 'per_hour' | 'per_task', wageOfferedMinor: input.wageOfferedMinor,
      farmLat: input.farmLat, farmLng: input.farmLng, dailyHours: input.dailyHours,
    }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=booking`);
}

export async function assignWorkerAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const bookingId = String(formData.get('bookingId') ?? '').trim();
  const workerId = String(formData.get('workerId') ?? '').trim();
  const wageMinor = opt(formData.get('wageMinor'));
  if (!bookingId || !workerId) redirect(`${PATH}?error=assign`);
  const bad = validateAssignWage(wageMinor);
  if (bad) redirect(`${PATH}?error=${bad}`);
  try { await tenantClient().labour.assignWorker(bookingId, { workerId, wageMinor }, randomUUID()); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=assigned`);
}

export async function startBookingAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().labour.startBooking(id); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=started`);
}

export async function completeBookingAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().labour.completeBooking(id); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=completed`);
}

export async function cancelBookingAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().labour.cancelBooking(id, opt(formData.get('reason'))); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=cancelled`);
}

export async function payWagesAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().labour.payWages(id, randomUUID()); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=paid`);
}

export async function confirmAttendanceAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const assignmentId = String(formData.get('assignmentId') ?? '').trim();
  const workDate = String(formData.get('workDate') ?? '').trim();
  if (!assignmentId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) redirect(`${PATH}?error=attendance`);
  try { await tenantClient().labour.confirmAttendance(assignmentId, workDate, randomUUID()); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=confirmed`);
}
