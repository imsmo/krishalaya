'use server';
// apps/web-admin/src/app/integrations/actions.ts · W106's revoke chain + W1931–W1933 (PC-56 ADMIN-11c).
//
// admin-api re-authorises server-side: `platform.api.manage`, FIDO2 and step-up, and a reason of at least twenty
// characters. **REVOKING IS THE ONLY WRITE ON THIS PLANE, AND THERE IS NO ISSUE ACTION** — Law 11: the platform does not
// mint a credential that acts as a tenant. Oversight takes access away; it does not hand it out.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../lib/admin-client';

function apiErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    const msg = String(e.message ?? '');
    if (e.status === 403) return 'elevation';
    // 409 here means the key was ALREADY revoked, and re-revoking would overwrite the reason the first revocation
    // recorded — the only record of why an integration stopped working. A distinct message, not a generic conflict.
    if (e.status === 409) return /already revoked/i.test(msg) ? 'alreadyRevoked' : 'conflict';
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function revokeKeyAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id');
  const registry = str(formData, 'registry');
  const reason = str(formData, 'reason');
  if (!id || (registry !== 'tenant' && registry !== 'partner')) redirect('/integrations?error=invalid');
  // Twenty characters. Revoking breaks a live integration within a minute and its scheduled jobs fail closed;
  // "unused" is not a record of that decision.
  if (reason.length < 20) redirect('/integrations?error=reason');
  try {
    await adminPost(`platform-api/keys/${encodeURIComponent(id)}/revoke`, { body: { registry, reason } });
  } catch (e) { redirect(`/integrations?error=${apiErrorKey(e)}`); }
  revalidatePath('/integrations');
  redirect('/integrations?ok=revoked');
}
