'use server';
// apps/web-tenant/src/app/dairy/centres/actions.ts · W171's acts — PC-56 TENANT-6d-2.
//
// Three acts, and one of them is the reason this screen exists: *"operator assignment is recorded (custody of member
// milk)"*. Every one goes through the SDK to the audited, `dairy.manage`-gated API, which re-validates with zod
// `.strict()`, checks that the incoming operator holds an active role in this cooperative, and writes the custody row
// and the centre's column in ONE transaction.
//
// THE HANDOVER CARRIES AN IDEMPOTENCY-KEY (Law 3) and the other two do not, deliberately: a retried handover would
// otherwise close the custody it had just opened and open a third, leaving a phantom two-second tenure in a register
// whose whole job is answering "who was holding it". Setting hours and releasing custody are statements about the
// present, and repeating them is the same fact.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
// [TENANT-6d-3] The two shape rules the move needs live in the view-model, where a test can call them.
import { isCalendarDay, isMemberCode } from '../../../features/dairy/centres';

const PATH = '/dairy/centres';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

function fail(e: unknown): never {
  redirect(`${PATH}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
}

// W171's *"Add centre"* used to live here as `createCentreAction`. It is GONE, not deprecated: TENANT-6d-4 built
// W2555–W2558's chain at `/dairy/centres/new`, whose own action runs the same write behind a review the API computes.
// Two entry points to one write, with the maker-checker step on only one of them, is a defect with a schedule: the
// unreviewed path is the one somebody uses in a hurry.
/** Custody changes hands. */
export async function assignOperatorAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('mccId') ?? '').trim();
  const operatorUserId = String(formData.get('operatorUserId') ?? '').trim();
  if (!UUID.test(id)) redirect(`${PATH}?error=centre`);
  if (!UUID.test(operatorUserId)) redirect(`${PATH}?error=operator`);
  try {
    await tenantClient().dairy.assignMccOperator(id, { operatorUserId, reason: opt(formData.get('reason')) }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=assigned`);
}

/** Nobody holds the centre — a state a cooperative chooses, not the absence of one. */
export async function releaseOperatorAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('mccId') ?? '').trim();
  if (!UUID.test(id)) redirect(`${PATH}?error=centre`);
  try { await tenantClient().dairy.releaseMccOperator(id, opt(formData.get('reason'))); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=released`);
}

/**
 * The hours a farmer walks to — the thing TENANT-6a named and refused to invent.
 *
 * SUBMITTING BOTH FIELDS EMPTY CLEARS THE SHIFT. That is a real thing a cooperative does, and it returns the counter
 * board to TENANT-6a's honest refusal rather than leaving hours on a screen that nobody keeps any more.
 */
export async function setShiftWindowAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('mccId') ?? '').trim();
  const shift = String(formData.get('shift') ?? '').trim();
  const opens = opt(formData.get('opens'));
  const closes = opt(formData.get('closes'));
  if (!UUID.test(id)) redirect(`${PATH}?error=centre`);
  if (shift !== 'morning' && shift !== 'evening') redirect(`${PATH}?error=shift`);
  // Both ends or neither, checked here so a half-filled form never reaches the API — the same rule as the aggregate's
  // and as `ck_mcc_shift_*`, stated in three places because half a window reads as knowledge and answers nothing.
  if ((opens === undefined) !== (closes === undefined)) redirect(`${PATH}?error=halfWindow`);
  if (opens !== undefined && (!HHMM.test(opens) || !HHMM.test(closes as string))) redirect(`${PATH}?error=clock`);
  try { await tenantClient().dairy.setMccShiftWindow(id, { shift, opens, closes }); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=${opens === undefined ? 'hoursCleared' : 'hours'}`);
}

/**
 * W171: *"Moving house? The membership moves centres without losing history."* — PC-56 TENANT-6d-3.
 *
 * Idempotency-keyed, because a retried move would close the route period it had just opened and open a third, leaving
 * a one-day phantom in the very history this wave exists to keep trustworthy.
 *
 * The API decides everything: whether the card is free, whether the date contradicts a slip the member is holding,
 * whether the destination is taking milk. This action validates only what a form can (shape), so the refusal an
 * operator sees is the one function both the button and the act consult.
 */
export async function moveMembershipAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const membershipId = String(formData.get('membershipId') ?? '').trim();
  const toMccId = String(formData.get('toMccId') ?? '').trim();
  const newMemberCode = String(formData.get('newMemberCode') ?? '').trim();
  const effectiveFrom = opt(formData.get('effectiveFrom'));
  if (!UUID.test(membershipId)) redirect(`${PATH}?error=membership`);
  if (!UUID.test(toMccId)) redirect(`${PATH}?error=centre`);
  if (!isMemberCode(newMemberCode)) redirect(`${PATH}?error=memberCode`);
  if (effectiveFrom !== undefined && !isCalendarDay(effectiveFrom)) redirect(`${PATH}?error=day`);
  try {
    await tenantClient().dairy.moveMembership(membershipId, {
      toMccId, newMemberCode, effectiveFrom, reason: opt(formData.get('reason')),
    }, randomUUID());
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=moved`);
}
