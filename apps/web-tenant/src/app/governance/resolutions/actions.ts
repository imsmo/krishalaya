'use server';
// apps/web-tenant/src/app/governance/resolutions/actions.ts · W198 · the signed-in member's OWN ballot · PC-56 TENANT-9b.
//
// W198: "this console never casts votes for anyone" — there is no member parameter anywhere: the API takes `ctx.userId`.
// The choice is one the resolution DECLARES (the radio buttons come from the API's `choices`; anything else is refused 422,
// BALLOT_CHOICE_UNDECLARED, and by 0182's trigger underneath). A vote is changeable until close (TENANT-1e) — and since
// 9b actually changeable: the change path used to die on an aborted transaction.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { RESOLUTIONS_HREF } from '../../../features/governance/resolutions';

export async function castVoteAction(formData: FormData): Promise<void> {
  await requireSession(RESOLUTIONS_HREF);
  const id = String(formData.get('id') ?? '').trim();
  const choice = String(formData.get('choice') ?? '').trim();
  if (!id || !choice || choice.length > 20) redirect(`${RESOLUTIONS_HREF}?voteError=generic`);
  let changed = false;
  try { changed = (await tenantClient().memberships.castVote(id, choice)).changed; }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    if (err?.code === 'COOP_NOT_ELIGIBLE_TO_VOTE') {
      const d = err.details ?? {};
      const q = new URLSearchParams({ voteError: 'ineligible', reason: String(d.reason ?? '') });
      if (typeof d.sharesShort === 'number') q.set('short', String(d.sharesShort));
      if (typeof d.eligibleFrom === 'string') q.set('from', d.eligibleFrom);
      redirect(`${RESOLUTIONS_HREF}?${q.toString()}`);
    }
    redirect(`${RESOLUTIONS_HREF}?voteError=${err?.code === 'BALLOT_CHOICE_UNDECLARED' ? 'undeclared' : err?.status === 409 ? 'notOpen' : 'generic'}`);
  }
  revalidatePath(RESOLUTIONS_HREF);
  redirect(`${RESOLUTIONS_HREF}?ok=${changed ? 'changed' : 'voted'}`);
}
