'use server';
// apps/web-gov/src/app/mgnrega/actions.ts · GW-5 writes (PC-55 B2).
// Three acts, each carrying a legal weight the code is written to respect:
//   1. recordDemandAction   — starts a household's statutory 15-day clock. Idempotency-keyed, and the date recorded
//      is the day the HOUSEHOLD asked (never "now"), because that date is the entitlement.
//   2. transitionDemandAction — allot a REAL work, or end the demand with a reason said out loud.
//   3. exportAction         — an audit-stamped export; the receipt id is surfaced to the officer, since a file
//      without its provenance is exactly what the receipt law exists to prevent.
// Server permissions (booking.manage) and the API's own validation stay authoritative; these actions refuse only
// what they can refuse honestly and locally, so a desk operator gets an instant, explainable "no".
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { govClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildDemand, buildDemandTransition, isExportReport } from '../../features/mgnrega/program';
import { SdkError } from '@krishalaya/sdk-js';

function backToDemands(qs: string): never { redirect(`/mgnrega/demands?${qs}`); }
function errCode(e: unknown, fallback: string): string {
  if (!(e instanceof SdkError)) return fallback;
  if (e.status === 403) return 'forbidden';
  if (e.status === 409) return 'conflict';
  if (e.status === 404) return 'notfound';
  if (e.status === 400 || e.status === 422) return 'invalid';
  return fallback;
}

export async function recordDemandAction(formData: FormData): Promise<void> {
  await requireSession('/mgnrega/demands');
  const today = new Date().toISOString().slice(0, 10);
  const built = buildDemand({
    jobCardId: String(formData.get('jobCardId') ?? ''),
    demandedOn: String(formData.get('demandedOn') ?? ''),
    daysRequested: String(formData.get('daysRequested') ?? ''),
    applicants: String(formData.get('applicants') ?? ''),
    note: String(formData.get('note') ?? ''),
  }, today);
  if (!built.ok) backToDemands(`error=demand_${built.error}`);
  try {
    // A demand is not a retryable read: the Idempotency-Key means a double-submitted form cannot become two clocks.
    await govClient().labour.recordMgnregaDemand(built.value, randomUUID());
  } catch (e) {
    backToDemands(`error=${errCode(e, 'demand')}`);
  }
  revalidatePath('/mgnrega/demands'); revalidatePath('/mgnrega');
  backToDemands('ok=demand_recorded');
}

export async function transitionDemandAction(formData: FormData): Promise<void> {
  await requireSession('/mgnrega/demands');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/mgnrega/demands');
  const built = buildDemandTransition({
    to: String(formData.get('to') ?? ''),
    workId: String(formData.get('workId') ?? ''),
    allottedOn: String(formData.get('allottedOn') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  });
  if (!built.ok) backToDemands(`error=demand_${built.error}`);
  try { await govClient().labour.transitionMgnregaDemand(id, built.value); }
  catch (e) { backToDemands(`error=${errCode(e, 'demand')}`); }
  revalidatePath('/mgnrega/demands'); revalidatePath('/mgnrega');
  backToDemands(`ok=demand_${built.value.to}`);
}

/** The audit-stamped export. We deliberately do NOT stream a file here: the receipt is the point, so the officer is
 *  returned to the register with the receipt id, row count and generation time visible — that is what makes the
 *  saved data accountable rather than anonymous. */
export async function exportAction(formData: FormData): Promise<void> {
  const report = String(formData.get('report') ?? '');
  const from = String(formData.get('from') ?? '/mgnrega/job-cards');
  const target = from === '/mgnrega/demands' ? '/mgnrega/demands' : '/mgnrega/job-cards';
  await requireSession(target);
  if (!isExportReport(report)) redirect(`${target}?error=export_report`);
  // redirect() works by THROWING, so it must live outside the try — otherwise the catch below would swallow the
  // navigation and report a fake export failure.
  let receipt: { id: string; rowCount: number; generatedAt: string };
  try {
    receipt = (await govClient().labour.exportMgnrega({ report, limit: 2000 })).receipt;
  } catch (e) {
    redirect(`${target}?error=${errCode(e, 'export')}`);
  }
  const q = new URLSearchParams({ ok: 'exported', receipt: receipt.id, rows: String(receipt.rowCount), at: receipt.generatedAt });
  redirect(`${target}?${q}`);
}
