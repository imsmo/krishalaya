'use server';
// apps/web-admin/src/app/staff/actions.ts · the realm's own access controls (PC-56 ADMIN-9).
//
// These server actions take somebody's access to the god-mode realm away and give it back. admin-api re-authorises
// every one of them server-side (staff.manage or staff.reinstate + FIDO2 + step-up), enforces the two-person rule on
// reinstatement three separate ways, and audits each with a mandatory reason.
//
// **THERE IS NO ACTION HERE THAT GRANTS A PERMISSION, AND THERE MUST NEVER BE.** Platform permissions live in
// `owner-roles.ts`, the compiled catalogue the guard resolves against — a database path that could add one would make
// that catalogue advisory and hand anything with a write grant a route into god mode (Law 5, Law 11). Restrictions
// subtract; nothing adds.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../lib/admin-client';

function apiErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) {
      // 403 on this plane has two meanings and they are not interchangeable: the elevation was missing, or a second
      // person is required. The message decides, because conflating them would tell an operator to re-authenticate when
      // what they actually need is a colleague.
      const msg = String((e as AdminApiError).message ?? '');
      return /second administrator|requested this reinstatement/i.test(msg) ? 'secondPerson' : 'elevation';
    }
    if (e.status === 409) return 'conflict';
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/** Suspend. One operator, no checker — an emergency control that needed two people would be bypassed the first time it
 *  mattered. Live sessions end in the same transaction. */
export async function suspendOperatorAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'adminUserId');
  const reason = str(formData, 'reason');
  if (!id) redirect('/staff');
  if (reason.length < 10) redirect(`/staff/${enc(id)}?error=reason`);
  try { await adminPost(`staff/operators/${enc(id)}/suspend`, { body: { reason } }); }
  catch (e) { redirect(`/staff/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/staff/${id}`); revalidatePath('/staff');
  redirect(`/staff/${enc(id)}?ok=suspended`);
}

/** The maker's half of the fourteenth maker-checker site. */
export async function requestReinstateAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'adminUserId');
  const reason = str(formData, 'reason');
  if (!id) redirect('/staff');
  if (reason.length < 10) redirect(`/staff/${enc(id)}?error=reason`);
  try { await adminPost(`staff/operators/${enc(id)}/reinstate-request`, { body: { reason } }); }
  catch (e) { redirect(`/staff/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/staff/${id}`);
  redirect(`/staff/${enc(id)}?ok=reinstateRequested`);
}

/** The checker's half. This action does NOT re-check maker≠checker: the server does, and a second copy of the rule in
 *  the console is a second place for it to drift. What the console does instead is not render the control at all. */
export async function reinstateOperatorAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'adminUserId');
  if (!id) redirect('/staff');
  try { await adminPost(`staff/operators/${enc(id)}/reinstate`, { body: {} }); }
  catch (e) { redirect(`/staff/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/staff/${id}`); revalidatePath('/staff');
  redirect(`/staff/${enc(id)}?ok=reinstated`);
}

/** Deny only. `permissionCode` is validated server-side against the live catalogue — a restriction on a misspelled code
 *  would sit in the table, show on the roster, deny nothing, and be believed. */
export async function restrictOperatorAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'adminUserId');
  const permissionCode = str(formData, 'permissionCode');
  const reason = str(formData, 'reason');
  const days = str(formData, 'expiresInDays');
  if (!id) redirect('/staff');
  if (!permissionCode) redirect(`/staff/${enc(id)}?error=code`);
  if (reason.length < 10) redirect(`/staff/${enc(id)}?error=reason`);

  const body: Record<string, unknown> = { permissionCode, reason };
  if (days) {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) redirect(`/staff/${enc(id)}?error=expiry`);
    body.expiresAt = new Date(Date.now() + n * 86_400_000).toISOString();
  }
  try { await adminPost(`staff/operators/${enc(id)}/restrictions`, { body }); }
  catch (e) { redirect(`/staff/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/staff/${id}`);
  redirect(`/staff/${enc(id)}?ok=restricted`);
}

export async function liftRestrictionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'adminUserId');
  const rid = str(formData, 'restrictionId');
  const reason = str(formData, 'reason');
  if (!id || !rid) redirect('/staff');
  if (reason.length < 10) redirect(`/staff/${enc(id)}?error=reason`);
  try { await adminPost(`staff/operators/${enc(id)}/restrictions/${enc(rid)}/lift`, { body: { reason } }); }
  catch (e) { redirect(`/staff/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/staff/${id}`);
  redirect(`/staff/${enc(id)}?ok=lifted`);
}

/** End somebody else's session — the narrow version of a suspension, and elevated the same way. */
export async function revokeOperatorSessionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'adminUserId');
  const sid = str(formData, 'sessionId');
  const reason = str(formData, 'reason');
  if (!id || !sid) redirect('/staff');
  if (reason.length < 5) redirect(`/staff/${enc(id)}?error=reason`);
  try { await adminPost(`staff/operators/${enc(id)}/sessions/${enc(sid)}/revoke`, { body: { reason } }); }
  catch (e) { redirect(`/staff/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/staff/${id}`);
  redirect(`/staff/${enc(id)}?ok=sessionRevoked`);
}

/**
 * End one of MY OWN sessions, including the one I am holding. No permission is required and none should be: signing out
 * a device you have lost is not a privileged act, and gating it would leave the one credential an attacker is using.
 *
 * When it is the current session, the next request will be refused — so the redirect goes to the security page, which
 * will bounce to login. Deliberately not a "you have been signed out" screen: the console cannot promise that until the
 * refusal has actually happened, and the refusal is the login redirect.
 */
export async function revokeOwnSessionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const sid = str(formData, 'sessionId');
  const reason = str(formData, 'reason');
  if (!sid) redirect('/staff/security');
  if (reason.length < 5) redirect('/staff/security?error=reason');
  try { await adminPost(`staff/me/sessions/${enc(sid)}/revoke`, { body: { reason } }); }
  catch (e) { redirect(`/staff/security?error=${apiErrorKey(e)}`); }
  revalidatePath('/staff/security');
  redirect('/staff/security?ok=sessionRevoked');
}

/** The two numbers that decide when the realm locks somebody out. */
export async function setAccessPolicyAction(formData: FormData): Promise<void> {
  requireAdmin();
  const dormantAfterDays = Number(str(formData, 'dormantAfterDays'));
  const suspendAfterDays = Number(str(formData, 'suspendAfterDays'));
  const touchIntervalSec = Number(str(formData, 'touchIntervalSec') || '60');
  const reason = str(formData, 'reason');
  if (![dormantAfterDays, suspendAfterDays, touchIntervalSec].every(Number.isInteger)) redirect('/staff?error=invalid');
  if (suspendAfterDays <= dormantAfterDays) redirect('/staff?error=policyOrder');
  if (reason.length < 10) redirect('/staff?error=reason');
  try {
    await adminPost('staff/access-policy', {
      body: { dormantAfterDays, suspendAfterDays, touchIntervalSec, reason },
    });
  } catch (e) { redirect(`/staff?error=${apiErrorKey(e)}`); }
  revalidatePath('/staff');
  redirect('/staff?ok=policy');
}
