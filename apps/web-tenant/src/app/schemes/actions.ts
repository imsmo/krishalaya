'use server';
// apps/web-tenant/src/app/schemes/actions.ts · scheme officer (scheme.process) mutations + an on-behalf eligibility
// check. Every write goes through the SDK to the audited, RBAC-gated + `schemes`-flagged API, which runs the
// application state machine and records observed DBT credits (money is bigint minor; DBT is an OBSERVED PFMS
// credit, not a wallet move). This layer only shapes + pre-validates the form and surfaces the API's typed error.
// 'use server' modules export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { validateDbt, validateEligibility, validateNote } from '../../features/schemes/operator';

const PATH = '/schemes';
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };
const back = (id?: string) => id ? `${PATH}?application=${encodeURIComponent(id)}` : PATH;

function fail(e: unknown, id?: string): never {
  const b = back(id);
  redirect(`${b}${b.includes('?') ? '&' : '?'}error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
}

export async function verifyApplicationAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().schemes.verifyApplication(id); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=verify`);
}

export async function clarifyApplicationAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const note = opt(formData.get('note'));
  if (!id) redirect(`${PATH}?error=save`);
  if (validateNote(note)) redirect(`${back(id)}&error=note`);
  try { await tenantClient().schemes.requestClarification(id, note); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=clarify`);
}

export async function approveApplicationAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const govtAppRef = opt(formData.get('govtAppRef'));
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().schemes.approveApplication(id, govtAppRef); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=approve`);
}

export async function rejectApplicationAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const reason = opt(formData.get('reason'));
  if (!id) redirect(`${PATH}?error=save`);
  if (validateNote(reason)) redirect(`${back(id)}&error=reason`);
  try { await tenantClient().schemes.rejectApplication(id, reason); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=reject`);
}

export async function closeApplicationAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().schemes.closeApplication(id); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=close`);
}

export async function recordDbtAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const amountMinor = String(formData.get('amountMinor') ?? '').trim();
  const creditedOn = String(formData.get('creditedOn') ?? '').trim();
  const instalmentNo = opt(formData.get('instalmentNo'));
  if (!id) redirect(`${PATH}?error=save`);
  const bad = validateDbt({ amountMinor, creditedOn, instalmentNo });
  if (bad) redirect(`${back(id)}&error=${bad}`);
  try {
    await tenantClient().schemes.recordDbt(id, { amountMinor, creditedOn, instalmentNo: instalmentNo ? Number(instalmentNo) : undefined, pfmsRef: opt(formData.get('pfmsRef')) });
  } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=dbt`);
}

/** Run the deterministic eligibility check on behalf of an applicant; surface the result via a one-shot flash. */
export async function checkEligibilityAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const schemeId = String(formData.get('schemeId') ?? '').trim();
  const landholdingAcres = opt(formData.get('landholdingAcres'));
  const age = opt(formData.get('age'));
  const gender = opt(formData.get('gender'));
  if (!schemeId) redirect(`${PATH}?error=scheme`);
  const bad = validateEligibility({ landholdingAcres, age, gender });
  if (bad) redirect(`${PATH}?error=${bad}`);
  let payload = '';
  try {
    const res = await tenantClient().schemes.checkEligibility(schemeId, {
      landholdingAcres: landholdingAcres ? Number(landholdingAcres) : undefined,
      age: age ? Number(age) : undefined,
      gender: gender as 'male' | 'female' | 'other' | undefined,
    });
    // Bounded one-shot flash: eligible flag + up to 5 short reasons.
    payload = Buffer.from(JSON.stringify({ e: res.eligible, r: (res.reasons || []).slice(0, 5).map((x) => String(x).slice(0, 120)) })).toString('base64');
  } catch (e) {
    redirect(`${PATH}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
  }
  redirect(`${PATH}?elig=${encodeURIComponent(payload)}`);
}
