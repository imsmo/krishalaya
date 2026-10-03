'use server';
// apps/web-tenant/src/app/settings/actions.ts · the only place the authed tenantClient() writes the tenant's own
// self-config: commission rules, delivery zones, branding + language settings. Every write is RBAC-gated + audited
// SERVER-SIDE (the API re-resolves the subject from the token, re-validates with zod .strict, and computes all
// money itself — Law 2/11). Creates are idempotency-keyed (Law 3). Validation lives in features/settings/config.ts;
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildLanguages, PLATFORM_LANGUAGES } from '../../features/settings/config';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/settings';
function done(ok: string) { revalidatePath(PATH); redirect(`${PATH}?ok=${ok}`); }
function fail(error: string): never { redirect(`${PATH}?error=${encodeURIComponent(error)}`); }
function sdkCode(e: unknown, fallback: string): string { return e instanceof SdkError ? (e.code || fallback) : fallback; }

// PC-56 TENANT-SW-a: a commission rule is no longer written here. It is PROPOSED on /money/commission (W149) at the plan's platform share,
// with 7 days' notice, and confirmed by a different tenant_admin; a deactivation is proposed the same way. Zones are proposed on
// /ops/logistics/zones (W233) and confirmed by a checker. These actions are kept so an old bookmarked form lands somewhere true.
export async function createCommissionRuleAction(_formData: FormData): Promise<void> {
  await requireSession(PATH);
  redirect('/money/commission/propose');
}

export async function deactivateCommissionRuleAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  redirect(/^[0-9a-f-]{36}$/i.test(id) ? `/money/commission/act?act=deactivate&id=${id}` : '/money/commission');
}

export async function createDeliveryZoneAction(_formData: FormData): Promise<void> {
  await requireSession(PATH);
  redirect('/ops/logistics/zones/new');
}

export async function setZoneActiveAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const isActive = String(formData.get('isActive') ?? '') === 'true';
  redirect(/^[0-9a-f-]{36}$/i.test(id) ? `/ops/logistics/zones/act?act=${isActive ? 'activate' : 'deactivate'}&id=${id}` : '/ops/logistics/zones');
}

export async function saveBrandingAction(_formData: FormData): Promise<void> {
  // PC-56 TENANT-13d: the `branding.*` settings are deprecated (0194 — read by nothing, values copied into the draft brand; the API
  // refuses SETTING_DEPRECATED). The brand is edited, checked and published at /settings/branding. Kept so an old bookmarked form
  // lands somewhere true instead of failing.
  await requireSession(PATH);
  redirect('/settings/branding');
}

// PC-56 TENANT-13b (F-14): languages are written to `tenant_languages` — the store every consumer reads — through the API's languages
// route, never to the `languages.enabled` / `languages.default` SETTINGS (deprecated by 0192 and refused by the database). The panel lives
// on /settings/org; this action is kept for any caller and writes the same store.
export async function saveLanguagesAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const built = buildLanguages(
    { enabled: formData.getAll('enabled').map(String), default: formData.get('default') },
    PLATFORM_LANGUAGES,
  );
  if (!built.ok) fail(`languages.${built.error}`);
  const enabled = formData.getAll('enabled').map(String).filter((c) => (PLATFORM_LANGUAGES as readonly string[]).includes(c));
  const primary = String(formData.get('default') ?? '');
  try { await tenantClient().orgSettings.putLanguages({ enabled, primary }, randomUUID()); }
  catch (e) { fail(sdkCode(e, 'languages.save')); }
  done('languages');
}
