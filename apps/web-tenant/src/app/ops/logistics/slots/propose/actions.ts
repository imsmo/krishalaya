'use server';
// apps/web-tenant/src/app/ops/logistics/slots/propose/actions.ts · W2399 "Propose slots" — the one write (PC-56 TENANT-SW-e): a
// PROPOSAL to the seller. Nothing reaches the seller's pickup_slots until the seller accepts (the database refuses any other writer).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { SLOTS_HREF, proposalCarry, proposalRefusals, proposalSlots, readProposalDraft } from '../../../../../features/swe/console';

export async function proposeSlotsAction(formData: FormData): Promise<void> {
  const base = `${SLOTS_HREF}/propose`;
  await requireSession(base);
  const q: Record<string, string> = {}; formData.forEach((v, k) => { if (typeof v === 'string') q[k] = v; });
  const d = readProposalDraft(q);
  const carry = new URLSearchParams(proposalCarry(d));
  if (proposalRefusals(d).length) { carry.set('step', 'review'); redirect(`${base}?${carry.toString()}`); }
  let id = '';
  try { id = (await tenantClient().pickupSlots.propose({ sellerUserId: d.sellerUserId, slots: proposalSlots(d), reason: d.reason }, String(q.idempotencyKey || ''))).id; }
  catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(SLOTS_HREF);
  redirect(`${base}?step=success&proposalId=${encodeURIComponent(id)}`);
}
