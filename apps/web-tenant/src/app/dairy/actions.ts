'use server';
// apps/web-tenant/src/app/dairy/actions.ts · dairy MCC-operator mutations. Every write goes through the SDK to the
// audited, RBAC-gated (`dairy.manage`) + `dairy`-flagged API, which re-validates with zod .strict, prices every
// collection, and moves money SERVER-SIDE through the wallet ledger (Law 2/11) — this layer only shapes + pre-checks
// the form and surfaces the API's typed error code. Create/record/generate/pay carry a fresh Idempotency-Key (Law 3).
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { validateMcc, validateMembership, validateRateCard, validateCollection } from '../../features/dairy/calc';

const PATH = '/dairy';
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

function fail(e: unknown): never {
  redirect(`${PATH}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
}

export async function createMccAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const code = String(formData.get('code') ?? '').trim();
  const defaultName = String(formData.get('defaultName') ?? '').trim();
  const bad = validateMcc({ code, defaultName });
  if (bad) redirect(`${PATH}?error=${bad}`);
  try {
    await tenantClient().dairy.createMcc({ code, defaultName, regionId: opt(formData.get('regionId')), operatorUserId: opt(formData.get('operatorUserId')), capacityLitresShift: opt(formData.get('capacityLitresShift')) }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=mcc`);
}

export async function setMccActiveAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const isActive = String(formData.get('isActive') ?? '') === 'true';
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().dairy.setMccActive(id, isActive); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=${isActive ? 'mcc.on' : 'mcc.off'}`);
}

export async function enrolMemberAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const farmerUserId = String(formData.get('farmerUserId') ?? '').trim();
  const mccId = String(formData.get('mccId') ?? '').trim();
  const memberCode = String(formData.get('memberCode') ?? '').trim();
  const paymentCycle = String(formData.get('paymentCycle') ?? 'weekly').trim();
  const bad = validateMembership({ farmerUserId, mccId, memberCode, paymentCycle });
  if (bad) redirect(`${PATH}?error=${bad}`);
  try {
    await tenantClient().dairy.enrolMember({ farmerUserId, mccId, memberCode, paymentCycle: paymentCycle as 'daily' | 'weekly' | 'fortnightly' | 'monthly', defaultAnimalType: opt(formData.get('defaultAnimalType')) as 'cow' | 'buffalo' | 'mixed' | undefined }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=member`);
}

export async function createRateCardAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const animalType = String(formData.get('animalType') ?? '').trim();
  const pricingModel = String(formData.get('pricingModel') ?? '').trim();
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  const ratePerKgFatMinor = opt(formData.get('ratePerKgFatMinor'));
  const ratePerKgSnfMinor = opt(formData.get('ratePerKgSnfMinor'));
  const baseRatePerLitreMinor = opt(formData.get('baseRatePerLitreMinor'));
  const bad = validateRateCard({ animalType, pricingModel, ratePerKgFatMinor, ratePerKgSnfMinor, baseRatePerLitreMinor, effectiveFrom });
  if (bad) redirect(`${PATH}?error=${bad}`);
  try {
    await tenantClient().dairy.createRateCard({ defaultName: String(formData.get('defaultName') ?? '').trim() || `${animalType} ${pricingModel}`, animalType: animalType as 'cow' | 'buffalo' | 'mixed', pricingModel: pricingModel as 'two_axis' | 'fat_pooled' | 'snf_pooled', ratePerKgFatMinor, ratePerKgSnfMinor, baseRatePerLitreMinor, effectiveFrom, effectiveTo: opt(formData.get('effectiveTo')) }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=ratecard`);
}

export async function recordCollectionAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const membershipId = String(formData.get('membershipId') ?? '').trim();
  const shift = String(formData.get('shift') ?? '').trim();
  const collectedOn = String(formData.get('collectedOn') ?? '').trim();
  const weightKg = String(formData.get('weightKg') ?? '').trim();
  const fatPct = String(formData.get('fatPct') ?? '').trim();
  const snfPct = String(formData.get('snfPct') ?? '').trim();
  if (!membershipId) redirect(`${PATH}?error=membership`);
  const bad = validateCollection({ weightKg, fatPct, snfPct, collectedOn, shift });
  if (bad) redirect(`${PATH}?error=${bad}`);
  try {
    await tenantClient().dairy.recordCollection({ membershipId, shift: shift as 'morning' | 'evening', collectedOn, weightKg, fatPct, snfPct, waterFlag: String(formData.get('waterFlag') ?? '') === 'on' }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=collection`);
}

export async function generateBillAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const membershipId = String(formData.get('membershipId') ?? '').trim();
  const periodStart = String(formData.get('periodStart') ?? '').trim();
  const periodEnd = String(formData.get('periodEnd') ?? '').trim();
  if (!membershipId || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) redirect(`${PATH}?error=period`);
  try { await tenantClient().dairy.generateBill({ membershipId, periodStart, periodEnd }, randomUUID()); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=bill`);
}

export async function previewBillAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().dairy.previewBill(id); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=bill.previewed`);
}

export async function approveBillAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().dairy.approveBill(id); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=bill.approved`);
}

export async function payBillAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().dairy.payBill(id, randomUUID()); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=bill.paid`);
}
