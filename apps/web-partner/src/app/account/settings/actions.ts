'use server';
// apps/web-partner/src/app/account/settings/actions.ts · PC-56 PARTNER-1a · founder D5 — the settings page's three REAL acts, over PARTNER-0's
// team routes (the API decides who may: `partner.team.manage`, the last-admin rule, the reason rule, single-use invites):
//   • inviteMemberAction — W3006 → W3007 / W3008: returns the outcome to the client step machine (the code rides the RESPONSE only, never a URL);
//     the Idempotency-Key was minted at render and comes back from the confirm step's hidden field;
//   • revokeInviteAction / removeMemberAction — the confirm form's POST: a reason (10–500), then back to the page with `?done=` or `?failed=CODE`.
// 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { isPartnerRoleCode, reasonOk } from '../../../features/partner1/settings';
import type { InviteOutcome } from '../../../components/partner1/InviteChain';

const codeOf = (e: unknown) => (e instanceof SdkError ? (e.status === 429 ? 'RATE_LIMITED' : e.code) : 'unknown');

export async function inviteMemberAction(input: { phone: string; roleCode: string }, idempotencyKey: string): Promise<InviteOutcome> {
  await requirePartner();
  if (!isPartnerRoleCode(input.roleCode)) return { ok: false, code: 'PARTNER_ROLE_REQUIRED' };
  if (!idempotencyKey) return { ok: false, code: 'unknown' };
  try {
    const r = await partnerClient().partner.team.invite({ phone: String(input.phone ?? '').trim(), roleCode: input.roleCode }, idempotencyKey);
    return { ok: true, result: { token: r.token, expiresAt: r.expiresAt, phoneMasked: r.phoneMasked, roleCode: r.roleCode } };
  } catch (e) {
    return { ok: false, code: codeOf(e) };
  }
}

export async function teamActAction(formData: FormData): Promise<void> {
  await requirePartner();
  const act = String(formData.get('act') ?? ''); const id = String(formData.get('id') ?? ''); const reason = String(formData.get('reason') ?? '');
  if (!id || (act !== 'revoke_invite' && act !== 'remove_member')) redirect('/account/settings');
  if (!reasonOk(reason)) redirect('/account/settings?failed=PARTNER_REASON_REQUIRED');
  try {
    if (act === 'revoke_invite') await partnerClient().partner.team.revokeInvite(id, reason);
    else await partnerClient().partner.team.removeMember(id, reason);
  } catch (e) {
    redirect(`/account/settings?failed=${encodeURIComponent(codeOf(e))}`);
  }
  redirect(`/account/settings?done=${act === 'revoke_invite' ? 'revoked' : 'removed'}`);
}
