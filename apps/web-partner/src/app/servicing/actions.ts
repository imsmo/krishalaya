'use server';
// apps/web-partner/src/app/servicing/actions.ts · post-disbursal servicing writes (PC-55 B7, on W54-8).
// Four acts, each one touching a borrower's real obligation, so each is built by a PURE builder first and only then
// sent: a KCC ledger entry, a restructure proposal, a restructure transition, and a write-off.
//
// WHAT THE SERVER OWNS AND THIS FILE NEVER DUPLICATES: the running KCC balance (computed under a row lock, and
// refused if a repayment would push it below zero), the restructure state machine, MAKER≠CHECKER on approval, and
// the "only overdue can be written off" guard. The console's job is to send an exact body and to translate a refusal
// into a sentence — never to pre-compute money or to decide a transition it merely displays.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildKccEntry, buildRestructure, buildWriteOff, isRestructureStatus } from '../../features/lending/servicing';
import { parseMajorToMinor } from '../../features/money';

function back(loanId: string, qs: string): never {
  redirect(`/servicing?loanId=${encodeURIComponent(loanId)}&${qs}`);
}
function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';        // includes maker-checker: the checker must differ from the proposer
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'illegal';          // includes "repayment exceeds the drawn balance"
    if (e.status === 400 || e.status === 422) return 'invalid';
  }
  return 'generic';
}

export async function kccEntryAction(formData: FormData): Promise<void> {
  await requirePartner();
  const loanId = String(formData.get('loanId') ?? '').trim();
  if (!loanId) redirect('/servicing');
  const built = buildKccEntry({
    entryKind: String(formData.get('entryKind') ?? ''),
    amountMajor: String(formData.get('amountMajor') ?? ''),
    narrative: String(formData.get('narrative') ?? ''),
    destinationKind: String(formData.get('destinationKind') ?? ''),
    repaymentChannel: String(formData.get('repaymentChannel') ?? ''),
  }, parseMajorToMinor);
  if (!built.ok) back(loanId, `error=kcc_${built.error}`);
  try { await partnerClient().fintech.kccEntry(loanId, built.value); }
  catch (e) { back(loanId, `error=${apiErrorKey(e)}`); }
  revalidatePath('/servicing');
  back(loanId, 'ok=kcc');
}

export async function proposeRestructureAction(formData: FormData): Promise<void> {
  await requirePartner();
  const loanId = String(formData.get('loanId') ?? '').trim();
  if (!loanId) redirect('/servicing');
  const built = buildRestructure({
    reasonCode: String(formData.get('reasonCode') ?? ''),
    oldInstalmentMajor: String(formData.get('oldInstalmentMajor') ?? ''),
    newInstalmentMajor: String(formData.get('newInstalmentMajor') ?? ''),
    oldTenorMonths: String(formData.get('oldTenorMonths') ?? ''),
    newTenorMonths: String(formData.get('newTenorMonths') ?? ''),
    rateAprBps: String(formData.get('rateAprBps') ?? ''),
    currentRateAprBps: Number(formData.get('currentRateAprBps') ?? NaN),
    totalInterestDeltaMajor: String(formData.get('totalInterestDeltaMajor') ?? ''),
    caseRef: String(formData.get('caseRef') ?? ''),
    holidayMonths: String(formData.get('holidayMonths') ?? ''),
    holidayStartsOn: String(formData.get('holidayStartsOn') ?? ''),
    penalInterestWaived: formData.get('penalInterestWaived') === '1',
  }, parseMajorToMinor);
  if (!built.ok) back(loanId, `error=rs_${built.error}`);
  try { await partnerClient().fintech.proposeRestructure(loanId, built.value as unknown as Record<string, unknown>); }
  catch (e) { back(loanId, `error=${apiErrorKey(e)}`); }
  revalidatePath('/servicing');
  back(loanId, 'ok=proposed');
}

export async function transitionRestructureAction(formData: FormData): Promise<void> {
  await requirePartner();
  const loanId = String(formData.get('loanId') ?? '').trim();
  const id = String(formData.get('id') ?? '').trim();
  const to = String(formData.get('to') ?? '').trim();
  if (!loanId || !id) redirect('/servicing');
  // The transition vocabulary is closed: a value outside it never reaches the API.
  if (!isRestructureStatus(to)) back(loanId, 'error=rs_to');
  try { await partnerClient().fintech.transitionRestructure(id, to as 'mediation' | 'accepted' | 'checker_approved' | 'activated' | 'rejected' | 'expired'); }
  catch (e) { back(loanId, `error=${apiErrorKey(e)}`); }
  revalidatePath('/servicing');
  back(loanId, `ok=rs_${to}`);
}

export async function writeOffAction(formData: FormData): Promise<void> {
  await requirePartner();
  const loanId = String(formData.get('loanId') ?? '').trim();
  if (!loanId) redirect('/servicing');
  const built = buildWriteOff({ reason: String(formData.get('reason') ?? '') }, String(formData.get('loanStatus') ?? ''));
  if (!built.ok) back(loanId, `error=wo_${built.error}`);
  try { await partnerClient().fintech.writeOff(loanId, built.value.reason); }
  catch (e) { back(loanId, `error=${apiErrorKey(e)}`); }
  revalidatePath('/servicing'); revalidatePath('/portfolio');
  back(loanId, 'ok=writtenOff');
}
