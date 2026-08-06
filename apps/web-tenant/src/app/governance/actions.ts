'use server';
// apps/web-tenant/src/app/governance/actions.ts · cooperative governance writes (PC-55 B8, on W54-7).
// Create a resolution, move it draft→open→closed, and cast one ballot.
//
// THE TWO THINGS THIS FILE WILL NOT DO: re-open a closed vote (the API has no such transition, and re-opening after
// members have seen a tally is how a cooperative's trust dies), and pretend a dividend vote paid anybody — the
// payout run is a separate, separately-gated act (PC-55 A8), and the page says so.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildResolution, buildVote } from '../../features/governance/agm';

function back(qs: string): never { redirect(`/governance?${qs}`); }
function errKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    // 409 covers: not a draft / not open / voting not started / voting closed / already voted.
    if (e.status === 409) return 'illegal';
    if (e.status === 400 || e.status === 422) return 'invalid';
  }
  return 'generic';
}

export async function createResolutionAction(formData: FormData): Promise<void> {
  await requireSession('/governance');
  const built = buildResolution({
    title: String(formData.get('title') ?? ''),
    resolutionType: String(formData.get('resolutionType') ?? ''),
    body: String(formData.get('body') ?? ''),
    votingOpens: String(formData.get('votingOpens') ?? ''),
    votingCloses: String(formData.get('votingCloses') ?? ''),
  });
  if (!built.ok) back(`error=res_${built.error}`);
  try { await tenantClient().memberships.createResolution(built.value, randomUUID()); }
  catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/governance');
  back('ok=created');
}

export async function transitionResolutionAction(formData: FormData): Promise<void> {
  await requireSession('/governance');
  const id = String(formData.get('id') ?? '').trim();
  const to = String(formData.get('to') ?? '').trim();
  if (!id) redirect('/governance');
  if (to !== 'open' && to !== 'closed') back('error=res_to');
  try {
    const m = tenantClient().memberships;
    if (to === 'open') await m.openResolution(id); else await m.closeResolution(id);
  } catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/governance');
  back(`ok=${to}`);
}

export async function castVoteAction(formData: FormData): Promise<void> {
  await requireSession('/governance');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/governance');
  const built = buildVote({ choice: String(formData.get('choice') ?? '') });
  if (!built.ok) back(`error=res_${built.error}`);
  try { await tenantClient().memberships.castVote(id, built.value.choice); }
  catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/governance');
  back('ok=voted');
}
