'use server';
// apps/web-admin/src/app/settings/actions.ts · W103 (PC-56 ADMIN-11).
//
// Every write here reaches every tenant that has not overridden the key. admin-api re-authorises server-side
// (settings.manage + FIDO2 + step-up), demands a reason of at least twenty characters, and refuses a money-path or
// security key unless a DIFFERENT administrator proposed it.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../lib/admin-client';

function apiErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    // 403 on this plane means one of two different things and the message decides: the elevation was stale, or a second
    // administrator is required. Conflating them would tell an operator to re-authenticate when what they need is a
    // colleague.
    if (e.status === 403) {
      return /second|checker|proposer/i.test(String(e.message ?? '')) ? 'secondPerson' : 'elevation';
    }
    if (e.status === 409) return 'conflict';
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/** Parse the typed value from a form field. **A TYPE MISMATCH IS REFUSED HERE AND AGAIN ON THE SERVER**, and the server
 *  is the authority — this exists so an operator learns before the round trip, never as the control. */
function parseValue(type: string, raw: string): unknown {
  if (type === 'bool') return raw === 'true';
  if (type === 'int' || type === 'decimal') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    // The whole-number rule lives on the server (`assertValue` refuses 48.5 rather than rounding); this only refuses
    // what is not a number at all, so the server's message is the one the operator sees for a near-miss.
    return n;
  }
  if (type === 'json') {
    try { return JSON.parse(raw); } catch { return undefined; }
  }
  return raw;
}

export async function setSettingValueAction(formData: FormData): Promise<void> {
  requireAdmin();
  const key = str(formData, 'key');
  const type = str(formData, 'valueType');
  const raw = str(formData, 'value');
  const reason = str(formData, 'reason');
  const proposedByAdminId = str(formData, 'proposedByAdminId');
  if (!key) redirect('/settings');
  if (reason.length < 20) redirect(`/settings/${enc(key)}?error=reason`);
  const value = parseValue(type, raw);
  if (value === undefined) redirect(`/settings/${enc(key)}?error=value`);
  try {
    await adminPost(`settings/${enc(key)}/value`, {
      body: { value, reason, ...(proposedByAdminId ? { proposedByAdminId } : {}) },
    });
  } catch (e) { redirect(`/settings/${enc(key)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/settings/${key}`); revalidatePath('/settings');
  redirect(`/settings/${enc(key)}?ok=set`);
}

/** Back to the shipped default. Same checker rule as setting it — a revert that needed one person would be the way
 *  around a two-person rule. */
export async function revertSettingAction(formData: FormData): Promise<void> {
  requireAdmin();
  const key = str(formData, 'key');
  const reason = str(formData, 'reason');
  const proposedByAdminId = str(formData, 'proposedByAdminId');
  if (!key) redirect('/settings');
  if (reason.length < 20) redirect(`/settings/${enc(key)}?error=reason`);
  try {
    await adminPost(`settings/${enc(key)}/revert`, {
      body: { reason, ...(proposedByAdminId ? { proposedByAdminId } : {}) },
    });
  } catch (e) { redirect(`/settings/${enc(key)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/settings/${key}`);
  redirect(`/settings/${enc(key)}?ok=reverted`);
}

/** **A NEW SETTING IS AN INSERT, NEVER A MIGRATION** — W103's own sentence, and this is the form that keeps it. */
export async function defineSettingAction(formData: FormData): Promise<void> {
  requireAdmin();
  const key = str(formData, 'key');
  const valueType = str(formData, 'valueType');
  const scope = str(formData, 'scope') || 'tenant';
  const riskClass = str(formData, 'riskClass') || 'ordinary';
  const raw = str(formData, 'defaultValue');
  const reason = str(formData, 'reason');
  if (!key || !valueType) redirect('/settings?error=invalid');
  if (reason.length < 20) redirect('/settings?error=reason');
  const defaultValue = parseValue(valueType, raw);
  if (defaultValue === undefined) redirect('/settings?error=value');
  try {
    await adminPost('settings', {
      body: {
        key, valueType, scope, riskClass, defaultValue, reason,
        description: str(formData, 'description') || undefined,
        lockNote: str(formData, 'lockNote') || undefined,
      },
    });
  } catch (e) { redirect(`/settings?error=${apiErrorKey(e)}`); }
  revalidatePath('/settings');
  redirect('/settings?ok=defined');
}
