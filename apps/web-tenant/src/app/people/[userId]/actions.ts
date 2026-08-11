'use server';
// apps/web-tenant/src/app/people/[userId]/actions.ts · W154's danger zone (PC-56 TENANT-1b-2).
//
// Two Server Actions, each re-authorised server-side within the caller's own tenant (`user.approve` — NOT god-mode,
// Law 11). Both take a reason and both are recorded; the API writes the record and its audit row in one transaction.
//
// **THESE ACTIONS CANNOT SUSPEND A MEMBER PLATFORM-WIDE, BECAUSE THE ROUTE THEY CALL CANNOT.** There is no scope
// parameter to get wrong: the API writes a tenant-scoped suspension record and never touches `users.status`, which is the
// global column. A console that offered the choice would eventually see somebody make it.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildSuspensionReason } from '../../../features/people/suspension';
import { SdkError } from '@krishalaya/sdk-js';

/** `member` is the path segment; the reason arrives from the form. */
export async function suspendMemberAction(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '').trim();
  await requireSession(`/people/${userId}`);
  const built = buildSuspensionReason(String(formData.get('reason') ?? ''));
  if (!userId) redirect('/people');
  if (!built.ok) redirect(`/people/${userId}?error=reason`);

  try {
    const res = await tenantClient().members.suspend(userId, built.value);
    revalidatePath(`/people/${userId}`);
    // **"ALREADY SUSPENDED" IS REPORTED AS ITSELF, NOT AS SUCCESS.** The API refuses a second live episode, so the reason
    // just typed was NOT recorded — telling the staff member "suspended" would leave them believing it was.
    redirect(`/people/${userId}?ok=${res.outcome === 'already_suspended' ? 'alreadySuspended' : 'suspended'}`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`/people/${userId}?error=${errorKey(e)}`);
  }
}

export async function reinstateMemberAction(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '').trim();
  await requireSession(`/people/${userId}`);
  const built = buildSuspensionReason(String(formData.get('reason') ?? ''));
  if (!userId) redirect('/people');
  if (!built.ok) redirect(`/people/${userId}?error=reason`);

  try {
    await tenantClient().members.reinstate(userId, built.value);
    revalidatePath(`/people/${userId}`);
    redirect(`/people/${userId}?ok=reinstated`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`/people/${userId}?error=${errorKey(e)}`);
  }
}

/** Next signals a redirect by THROWING, so a catch-all `catch` around a `redirect()` swallows the navigation and turns a
 *  success into an error banner. Checked explicitly rather than by ordering the code carefully and hoping. */
function isRedirect(e: unknown): boolean {
  return typeof (e as { digest?: unknown })?.digest === 'string'
    && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT');
}

function errorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    // 409 from the lift path means the member was not suspended after all — somebody else lifted it first, which is a
    // real thing on a shared member desk and deserves its own sentence.
    if (e.status === 409) return 'notSuspended';
    if (e.status === 400) return 'reason';
  }
  return 'failed';
}
