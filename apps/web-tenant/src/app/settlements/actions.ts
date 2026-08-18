'use server';
// apps/web-tenant/src/app/settlements/actions.ts · W147's close request / decision / generation pass and
// W148's org statement (PC-56 TENANT-4c). Every refusal is translated BY NAME: a cycle close that fails with
// "something went wrong" gets pressed again over the same fortnight of a member's trade.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { isClosedMonth, isMonthPeriod, isNoteLongEnough } from '../../features/settlements/console';
import { SdkError } from '@krishalaya/sdk-js';

const codeOf = (e: unknown) => (e instanceof SdkError ? String((e as { code?: string }).code ?? '') : '');

export async function requestCloseAction(form: FormData): Promise<void> {
  await requireSession('/settlements');
  const cycleId = String(form.get('cycleId') ?? '');
  try {
    await tenantClient().settlements.requestClose(cycleId);
    revalidatePath('/settlements');
    redirect('/settlements?ok=requested');
  } catch (e) {
    const code = codeOf(e);
    if (!code) throw e;
    redirect(`/settlements?error=${encodeURIComponent(code)}`);
  }
}

export async function decideCloseAction(form: FormData): Promise<void> {
  await requireSession('/settlements');
  const cycleId = String(form.get('cycleId') ?? '');
  const decision = String(form.get('decision') ?? '') === 'rejected' ? 'rejected' : 'approved';
  const note = String(form.get('note') ?? '');

  // The note floor is checked here as well as by the API and by 0144's CHECK — three layers, because a
  // rejection with no reason is a decision nobody can audit later.
  if (decision === 'rejected' && !isNoteLongEnough(note)) {
    redirect('/settlements?error=SETTLEMENT_CYCLE_NOTE_TOO_SHORT');
  }
  try {
    await tenantClient().settlements.decideClose(cycleId, { decision, note: note.trim() || undefined });
    revalidatePath('/settlements');
    redirect(`/settlements?ok=${decision === 'approved' ? 'approved' : 'rejected'}`);
  } catch (e) {
    const code = codeOf(e);
    if (!code) throw e;
    redirect(`/settlements?error=${encodeURIComponent(code)}`);
  }
}

/** ONE bounded pass. The operator presses it again while a remainder is showing — which is what makes a
 *  100,000-seller close finishable at all, and why the screen carries a count instead of claiming atomicity. */
export async function generatePassAction(form: FormData): Promise<void> {
  await requireSession('/settlements');
  const cycleId = String(form.get('cycleId') ?? '');
  try {
    const res = await tenantClient().settlements.generate(cycleId);
    revalidatePath('/settlements');
    revalidatePath('/settlements/statements');
    // The figure reported is the SERVER's recount over the statement rows, not what this call happened to
    // write — the same discipline as 4a's export receipt reporting its own row count.
    redirect(`/settlements?ok=generated&n=${res.statementsGenerated}`);
  } catch (e) {
    const code = codeOf(e);
    if (!code) throw e;
    redirect(`/settlements?error=${encodeURIComponent(code)}`);
  }
}

/** W148's "Download org statement — June". Derived from the ledger with a receipt; refuses an open month
 *  here as well as server-side, so a month that cannot be issued does not cost a round trip. */
export async function orgStatementAction(form: FormData): Promise<void> {
  await requireSession('/settlements/statements');
  const period = String(form.get('period') ?? '');
  if (!isMonthPeriod(period) || !isClosedMonth(period, new Date())) {
    redirect('/settlements/statements?error=ORG_STATEMENT_PERIOD_OPEN');
  }
  try {
    const res = await tenantClient().settlements.orgStatement(period);
    redirect(`/settlements/statements?ok=orgStatement&rows=${res.receipt.rowCount}&period=${encodeURIComponent(period)}`);
  } catch (e) {
    const code = codeOf(e);
    if (!code) throw e;
    redirect(`/settlements/statements?error=${encodeURIComponent(code)}`);
  }
}
