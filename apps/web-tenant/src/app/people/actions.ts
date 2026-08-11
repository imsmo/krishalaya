'use server';
// apps/web-tenant/src/app/people/actions.ts · the ONE write on the people-roster path: unmasking a single PII field of a
// single member, with a reason (W153, PC-56 TENANT-1b).
//
// **THIS ACTION RETURNS THE VALUE TO THE CALLER AND PUTS IT NOWHERE ELSE.** No redirect carrying it in a query string
// (URLs land in browser history, referrer headers and proxy logs), no cookie, no `revalidatePath` that would bake it into
// a cached render. The client component holds it in React state, so it is gone on the next navigation — which is the
// correct lifetime for a phone number somebody had to justify seeing.
//
// The reason is validated here for a fast, translated refusal, and AGAIN on the server, which is the actual control: the
// API writes the audit row BEFORE returning the value and refuses the reveal if that write fails.
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { buildReveal } from '../../features/people/roster';
import { SdkError } from '@krishalaya/sdk-js';

export type RevealResult =
  | { ok: true; field: string; value: string | null }
  | { ok: false; error: 'field' | 'reason' | 'forbidden' | 'notFound' | 'failed' };

export async function revealFieldAction(userId: string, rawField: string, rawReason: string): Promise<RevealResult> {
  await requireSession('/people');
  const built = buildReveal({ field: rawField, reason: rawReason });
  if (!built.ok) return { ok: false, error: built.error };
  const id = userId.trim();
  if (!id) return { ok: false, error: 'notFound' };

  try {
    const r = await tenantClient().members.revealField(id, built.value.field, built.value.reason);
    // A member with nothing on file returns `null`, which is a real answer ("nothing recorded") and not an error — it
    // saves a field officer asking twice for an email address that was never collected.
    return { ok: true, field: r.field, value: r.value };
  } catch (e) {
    if (e instanceof SdkError) {
      // 403 = this staff member does not hold `member.pii.reveal`. 404 = not a member of this organisation (the API
      // deliberately does not distinguish "no such person" from "not yours" — that would be an enumeration oracle).
      if (e.status === 403) return { ok: false, error: 'forbidden' };
      if (e.status === 404) return { ok: false, error: 'notFound' };
    }
    // **THE FAILURE IS NOT DECORATED WITH DETAIL.** An audit-write failure and a database timeout look the same from
    // here, and both mean the same thing to the user: no value was revealed. Guessing which would risk telling a caller
    // that the recording failed but the read succeeded — the exact impression the server's ordering exists to prevent.
    return { ok: false, error: 'failed' };
  }
}
