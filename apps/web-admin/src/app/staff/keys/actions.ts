'use server';
// apps/web-admin/src/app/staff/keys/actions.ts · PC-56 ADMIN-AUTH-1 — revoke a hardware key / an unused enrollment code.
//
// admin-api re-authorises both (hardware-key session + step-up; another operator's key also needs staff.manage; your own
// LAST key can never be revoked — add another first) and audits each with the reason. A 403 here is almost always a stale
// step-up: the redirect carries `error=elevation`, which the layout turns into a "confirm with your key" prompt.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../lib/admin-client';
import { safeNext } from '../../../features/admin-auth/admin-auth';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const errKey = (e: unknown) => e instanceof AdminApiError
  ? e.status === 403 ? 'elevation' : e.status === 409 ? 'keyRevoke' : e.status === 400 ? 'reason' : 'generic' : 'generic';
const back = (to: string, q: string) => `${to}${to.includes('?') ? '&' : '?'}${q}`;

export async function revokeKeyAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'keyId');
  const reason = str(formData, 'reason');
  const to = safeNext(str(formData, 'returnTo'), '/staff/keys');
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(back(to, 'error=generic'));
  if (reason.length < 10) redirect(back(to, 'error=reason'));
  try { await adminPost(`auth/keys/${encodeURIComponent(id)}/revoke`, { body: { reason } }); }
  catch (e) { redirect(back(to, `error=${errKey(e)}`)); }
  revalidatePath(to.split('?')[0]);
  redirect(back(to, 'ok=keyRevoked'));
}

export async function revokeCodeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'codeId');
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/staff/keys?error=generic');
  try { await adminPost(`auth/enrollment-codes/${encodeURIComponent(id)}/revoke`, { body: {} }); }
  catch (e) { redirect(`/staff/keys?error=${errKey(e)}`); }
  revalidatePath('/staff/keys');
  redirect('/staff/keys?ok=codeRevoked');
}
