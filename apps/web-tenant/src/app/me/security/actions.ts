'use server';
// apps/web-tenant/src/app/me/security/actions.ts · `/me/security` — the signed-in person's OWN second factor and conflicts (PC-56 TENANT-SW-c).
// The 2FA actions RETURN their answer to the client panel (never a redirect URL): the secret / otpauth URI and the recovery codes are
// shown ONCE, in React state only. The conflict declaration is a plain form (redirect with a status; nothing typed travels back).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { ME_SECURITY_HREF, codesFrom, isConflictRelation, isIdemKey, isUuid } from '../../../features/swc/console';

export type Fail = { ok: false; codes: string[] };
const codesOf = (e: unknown): Fail => { const err = e instanceof SdkError ? e : null; return { ok: false, codes: codesFrom(err?.code, err?.status, err?.details) }; };

export async function enrolTwoFactorAction(): Promise<{ ok: true; secret: string; otpauthUri: string } | Fail> {
  await requireSession(ME_SECURITY_HREF);
  try { const r = await tenantClient().meSecurity.enrolTwoFactor(); return { ok: true, secret: r.secret, otpauthUri: r.otpauthUri }; } catch (e) { return codesOf(e); }
}
export async function confirmTwoFactorAction(code: string): Promise<{ ok: true; recoveryCodes: string[] } | Fail> {
  await requireSession(ME_SECURITY_HREF);
  if (!/^\d{6}$/.test(String(code ?? '').trim())) return { ok: false, codes: ['TOTP_INVALID'] };
  try { const r = await tenantClient().meSecurity.confirmTwoFactor(String(code).trim()); revalidatePath(ME_SECURITY_HREF); return { ok: true, recoveryCodes: r.recoveryCodes }; } catch (e) { return codesOf(e); }
}
export async function disableTwoFactorAction(input: { code?: string; recoveryCode?: string }): Promise<{ ok: true } | Fail> {
  await requireSession(ME_SECURITY_HREF);
  const code = String(input.code ?? '').trim(); const rec = String(input.recoveryCode ?? '').trim();
  try { await tenantClient().meSecurity.disableTwoFactor(code ? { code } : { recoveryCode: rec }); revalidatePath(ME_SECURITY_HREF); return { ok: true }; } catch (e) { return codesOf(e); }
}

export async function declareMyConflictAction(formData: FormData): Promise<void> {
  await requireSession(ME_SECURITY_HREF);
  const member = String(formData.get('memberUserId') ?? ''); const relation = String(formData.get('relation') ?? '');
  const k = String(formData.get('idempotencyKey') ?? '');
  if (!isUuid(member) || !isConflictRelation(relation)) redirect(`${ME_SECURITY_HREF}?error=CONFLICT_INVALID#conflicts`);
  let failed: string[] | null = null;
  try {
    await tenantClient().meSecurity.declareConflict({ memberUserId: member, relation: relation as 'family', relationNote: String(formData.get('relationNote') ?? '').trim().slice(0, 200) || undefined,
      reason: String(formData.get('reason') ?? '').trim().slice(0, 500) }, isIdemKey(k) ? k : randomUUID());
  } catch (e) { failed = codesOf(e).codes; }
  if (failed) redirect(`${ME_SECURITY_HREF}?error=${encodeURIComponent(failed.join(','))}#conflicts`);
  revalidatePath(ME_SECURITY_HREF);
  redirect(`${ME_SECURITY_HREF}?declared=1#conflicts`);
}
