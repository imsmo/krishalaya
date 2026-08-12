'use server';
// apps/web-tenant/src/app/returns/actions.ts · returns/RMA lifecycle (PC-55 B8, on W54-2).
// The seller's four steps, and one of them moves money. The API re-validates the state AND the acting party on
// every call, so this file's job is to send an exact step and translate a refusal — never to decide one.
//
// REFUND IS THE ONLY MONEY LEG, and it is Resolve-gated server-side. The page withholds the button unless the
// session's token carries that permission (display gating only, lib/auth.getTenantPermissions), so an operator who
// cannot refund does not learn that by clicking. A 403 is still translated precisely, because a token claim can be
// stale and the API is the authority.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';

const STEPS = ['approve', 'reject', 'receive', 'refund'] as const;
type Step = (typeof STEPS)[number];

function back(qs: string): never { redirect(`/returns?${qs}`); }
// PC-56 TENANT-3b: the refund gate's refusals are named, not flattened into "illegal". An operator who is told
// "this needs a checker" does something useful next; one told "not allowed" presses again.
const GATE_ERRORS: Record<string, string> = {
  REFUND_NEEDS_CHECKER: 'needsChecker',
  REFUND_AWAITING_CHECKER: 'awaitingChecker',
  REFUND_REJECTED_BY_CHECKER: 'rejectedByChecker',
  REFUND_AMOUNT_CHANGED: 'amountChanged',
  REFUND_ALREADY_APPLIED: 'alreadyApplied',
  RETURN_INVALID: 'returnInvalid',
};
function errKey(e: unknown): string {
  if (e instanceof SdkError) {
    const code = String((e as { code?: string }).code ?? '');
    if (GATE_ERRORS[code]) return GATE_ERRORS[code];
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'illegal';
  }
  return 'generic';
}

export async function returnStepAction(formData: FormData): Promise<void> {
  await requireSession('/returns');
  const id = String(formData.get('id') ?? '').trim();
  const step = String(formData.get('step') ?? '').trim();
  if (!id) redirect('/returns');
  if (!(STEPS as readonly string[]).includes(step)) back('error=step');
  const returns = tenantClient().returns;
  try {
    const s = step as Step;
    if (s === 'approve') await returns.approve(id);
    else if (s === 'reject') await returns.reject(id);
    else if (s === 'receive') await returns.receive(id);
    else await returns.refund(id);
  } catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/returns');
  back(`ok=${step}`);
}

/** W142's "Inspect" (0139): the note is required at 20 characters because the buyer whose refund it decides reads
 *  it. Checked here so a short note is a form message, and again server-side because the API is the authority. */
export async function inspectReturnAction(formData: FormData): Promise<void> {
  await requireSession('/returns');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/returns');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length < 20) back('error=noteTooShort');
  try { await tenantClient().returns.inspect(id, note); }
  catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/returns');
  back('ok=inspect');
}

/** Propose a refund on a RETURN — the same plane the dispute door uses (one table, one threshold, one rule). */
export async function proposeReturnRefundAction(formData: FormData): Promise<void> {
  await requireSession('/returns');
  const id = String(formData.get('id') ?? '').trim();
  const amountMinor = String(formData.get('amountMinor') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  if (!id) redirect('/returns');
  if (!/^[1-9]\d{0,15}$/.test(amountMinor)) back('error=noAmount');
  if (note.length < 20) back('error=noteTooShort');
  try {
    await tenantClient().refundApprovals.propose({ subjectType: 'return', subjectId: id, amountMinor, note });
  } catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/returns');
  back('ok=proposed');
}
