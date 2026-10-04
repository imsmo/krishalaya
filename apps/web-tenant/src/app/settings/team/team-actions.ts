'use server';
// apps/web-tenant/src/app/settings/team/team-actions.ts · the writes of W183 / W184 and their chains — PC-56 TENANT-SW-c.
//   • inviteAction        — W2335 → W2336 / W2337: an SMS invite (the token is sent ONCE by SMS and never shown in the console);
//   • revokeInviteAction / addDirectlyAction — the team mutate chain (revoke with a reason; the admin-add exception with a reason);
//   • the staff chains (W2768–W2774): overrideAction (WHY required, optional expiry; a money / PII grant becomes a proposal),
//     revokeOverrideAction, removeAction (reason required — role, overrides, desks and this tenant's sessions), declareConflictForAction,
//     liftConflictAction, proposalAction (confirm by a SECOND admin, or refuse with a reason).
// Every key is the confirm page's; every refusal is named on the failure step; nothing a person typed travels in a success URL
// except masked values. 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import {
  INVITE_LANGUAGES, TEAM_ACT_HREF, TEAM_HREF, TEAM_INVITE_HREF, codesFrom, isConflictRelation, isIdemKey, isPermCode, isUuid, staffHref,
} from '../../../features/swc/console';
import { DIFF_PARAM, SEEN_FIELD, diffToken, verifyBeforeWrite } from '../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../features/mutate/verify-fields';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return codesFrom(err?.code, err?.status, err?.details); };
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? '').trim().slice(0, max);
const keyOf = (f: FormData) => { const k = str(f, 'idempotencyKey', 120); return isIdemKey(k) ? k : randomUUID(); };
const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter(isUuid).slice(0, 20);
const fail = (base: string, codes: string[], keep: Record<string, string> = {}): never =>
  redirect(`${base}${base.includes('?') ? '&' : '?'}${new URLSearchParams({ ...keep, step: 'failure', error: codes.join(',') }).toString()}`);

export async function inviteAction(formData: FormData): Promise<void> {
  await requireSession(TEAM_INVITE_HREF);
  const lang = str(formData, 'languageCode', 4);
  let out: { id: string; phoneMasked: string; expiresAt: string } | null = null;
  try {
    out = await tenantClient().team.invite({ phone: str(formData, 'phone', 20), roleCode: str(formData, 'roleCode', 50), deskIds: ids(formData, 'deskIds'),
      languageCode: (INVITE_LANGUAGES as readonly string[]).includes(lang) ? (lang as 'en' | 'hi' | 'gu') : 'en' }, keyOf(formData));
  } catch (e) { fail(TEAM_INVITE_HREF, codesOf(e)); }
  revalidatePath(TEAM_HREF);
  redirect(`${TEAM_INVITE_HREF}?${new URLSearchParams({ step: 'success', id: out!.id, phone: out!.phoneMasked, until: out!.expiresAt }).toString()}`);
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  await requireSession(TEAM_HREF);
  const id = str(formData, 'inviteId', 40);
  const base = `${TEAM_ACT_HREF}?act=revoke_invite&inviteId=${encodeURIComponent(id)}`;
  if (!isUuid(id)) fail(base, ['INVITE_NOT_FOUND']);
  // [PC-56 TENANT-SW-f · W318 §3] verify-before-write: the invite the confirm step showed, re-read — gone or changed → STALE_ROW, nothing written
  const seen = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => ((await tenantClient().team.overview({ limit: 1 })).invites.find((i) => i.id === id) ?? null) as never);
  void VERIFY_FIELDS.invite;
  if (!seen.ok) redirect(`${base}&${new URLSearchParams({ step: 'failure', error: seen.code, ...(seen.diffs.length ? { [DIFF_PARAM]: diffToken(seen.diffs) } : {}) }).toString()}`);
  try { await tenantClient().team.revokeInvite(id, str(formData, 'reason')); } catch (e) { fail(base, codesOf(e)); }
  revalidatePath(TEAM_HREF);
  redirect(`${base}&step=success`);
}

export async function addDirectlyAction(formData: FormData): Promise<void> {
  await requireSession(TEAM_HREF);
  const base = `${TEAM_ACT_HREF}?act=add_directly`;
  let userId = '';
  try {
    userId = (await tenantClient().team.addDirectly({ phone: str(formData, 'phone', 20), fullName: str(formData, 'fullName', 200) || undefined, roleCode: str(formData, 'roleCode', 50),
      deskIds: ids(formData, 'deskIds'), reason: str(formData, 'reason') }, keyOf(formData))).userId;
  } catch (e) { fail(base, codesOf(e)); }
  revalidatePath(TEAM_HREF);
  redirect(`${base}&step=success&userId=${encodeURIComponent(userId)}`);
}

// ─────────────────────────────── one staff member (W2768–W2774)
const staffBase = (userId: string, act: string) => `${staffHref(userId)}/act?act=${act}`;

// [PC-56 TENANT-SW-f · W318 §3] VERIFY BEFORE WRITE for every act on one staff member: the confirm step carried the staff record it showed
// (`kv_seen`: suspended, the role assignments, overrides, proposals, conflicts); it is re-read here before the write — a record that moved
// since is refused STALE_ROW with the diff and nothing is written; "re-check" re-opens the confirm step on today's record.
async function verifyStaff(formData: FormData, userId: string, base: string): Promise<void> {
  const seen = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => (await tenantClient().team.staff(userId)) as never);
  void VERIFY_FIELDS.staff;
  if (!seen.ok) redirect(`${base}&${new URLSearchParams({ step: 'failure', error: seen.code, ...(seen.diffs.length ? { [DIFF_PARAM]: diffToken(seen.diffs) } : {}) }).toString()}`);
}

export async function overrideAction(formData: FormData): Promise<void> {
  const userId = str(formData, 'userId', 40); await requireSession(staffHref(userId));
  const base = staffBase(userId, 'override');
  const utr = str(formData, 'userTenantRoleId', 40); const code = str(formData, 'permissionCode', 80);
  const exp = str(formData, 'expiresAt', 40);
  if (!isUuid(utr) || !isPermCode(code)) fail(base, ['VALIDATION_FAILED']);
  let status = 'applied';
  await verifyStaff(formData, userId, base);
  try {
    status = (await tenantClient().rbac.setOverride({ userTenantRoleId: utr, permissionCode: code, isGranted: str(formData, 'isGranted', 5) !== 'false', reason: str(formData, 'reason'),
      ...(exp ? { expiresAt: new Date(exp).toISOString() } : {}) })).status;
  } catch (e) { fail(base, codesOf(e)); }
  revalidatePath(staffHref(userId));
  redirect(`${base}&step=success&status=${status}`);
}

export async function revokeOverrideAction(formData: FormData): Promise<void> {
  const userId = str(formData, 'userId', 40); await requireSession(staffHref(userId));
  const utr = str(formData, 'userTenantRoleId', 40); const code = str(formData, 'permissionCode', 80);
  const base = `${staffBase(userId, 'revoke_override')}&userTenantRoleId=${encodeURIComponent(utr)}&permissionCode=${encodeURIComponent(code)}`;
  await verifyStaff(formData, userId, base);
  try { await tenantClient().rbac.revokeOverride({ userTenantRoleId: utr, permissionCode: code, reason: str(formData, 'reason') }); } catch (e) { fail(base, codesOf(e)); }
  revalidatePath(staffHref(userId));
  redirect(`${base}&step=success`);
}

export async function removeAction(formData: FormData): Promise<void> {
  const userId = str(formData, 'userId', 40); await requireSession(staffHref(userId));
  const utr = str(formData, 'assignmentId', 40);
  const base = `${staffBase(userId, 'remove')}&assignmentId=${encodeURIComponent(utr)}`;
  if (!isUuid(utr)) fail(base, ['ROLE_NOT_FOUND']);
  let bound = 0;
  await verifyStaff(formData, userId, base);
  try { bound = (await tenantClient().rbac.revoke(utr, str(formData, 'reason'))).sessionEndBoundSec ?? 0; } catch (e) { fail(base, codesOf(e)); }
  revalidatePath(staffHref(userId)); revalidatePath(TEAM_HREF);
  redirect(`${base}&step=success&bound=${bound}`);
}

export async function declareConflictForAction(formData: FormData): Promise<void> {
  const userId = str(formData, 'userId', 40); await requireSession(staffHref(userId));
  const base = staffBase(userId, 'declare_conflict');
  const relation = str(formData, 'relation', 12); const member = str(formData, 'memberUserId', 40);
  if (!isUuid(member) || !isConflictRelation(relation)) fail(base, ['CONFLICT_INVALID']);
  await verifyStaff(formData, userId, base);
  try {
    await tenantClient().team.declareConflictFor(userId, { memberUserId: member, relation: relation as 'family', relationNote: str(formData, 'relationNote', 200) || undefined, reason: str(formData, 'reason') }, keyOf(formData));
  } catch (e) { fail(base, codesOf(e)); }
  revalidatePath(staffHref(userId));
  redirect(`${base}&step=success`);
}

export async function liftConflictAction(formData: FormData): Promise<void> {
  const userId = str(formData, 'userId', 40); await requireSession(staffHref(userId));
  const id = str(formData, 'conflictId', 40);
  const base = `${staffBase(userId, 'lift_conflict')}&conflictId=${encodeURIComponent(id)}`;
  await verifyStaff(formData, userId, base);
  try { await tenantClient().team.liftConflict(id, str(formData, 'reason')); } catch (e) { fail(base, codesOf(e)); }
  revalidatePath(staffHref(userId));
  redirect(`${base}&step=success`);
}

export async function proposalAction(formData: FormData): Promise<void> {
  const userId = str(formData, 'userId', 40); await requireSession(staffHref(userId));
  const id = str(formData, 'proposalId', 40); const act = str(formData, 'act', 20) === 'refuse_proposal' ? 'refuse_proposal' : 'confirm_proposal';
  const base = `${staffBase(userId, act)}&proposalId=${encodeURIComponent(id)}`;
  await verifyStaff(formData, userId, base);
  try {
    if (act === 'confirm_proposal') await tenantClient().rbac.confirmOverrideProposal(id);
    else await tenantClient().rbac.refuseOverrideProposal(id, str(formData, 'reason'));
  } catch (e) { fail(base, codesOf(e)); }
  revalidatePath(staffHref(userId)); revalidatePath(TEAM_HREF);
  redirect(`${base}&step=success`);
}
