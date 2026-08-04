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
import {
  buildCommissionRule, buildDeliveryZone, buildBranding, buildLanguages, PLATFORM_LANGUAGES,
} from '../../features/settings/config';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/settings';
function done(ok: string) { revalidatePath(PATH); redirect(`${PATH}?ok=${ok}`); }
function fail(error: string): never { redirect(`${PATH}?error=${encodeURIComponent(error)}`); }
function sdkCode(e: unknown, fallback: string): string { return e instanceof SdkError ? (e.code || fallback) : fallback; }

export async function createCommissionRuleAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const built = buildCommissionRule({
    rateBps: formData.get('rateBps'), platformShareBps: formData.get('platformShareBps'),
    fixedMinor: formData.get('fixedMinor'), chargedTo: formData.get('chargedTo'),
    priority: formData.get('priority'), source: formData.get('source'),
  });
  if (!built.ok) fail(`commission.${built.error}`);
  try {
    await tenantClient().tenantConfig.createCommissionRule(built.value, randomUUID());
  } catch (e) { fail(sdkCode(e, 'commission.save')); }
  done('commission');
}

export async function deactivateCommissionRuleAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) fail('commission.save');
  try {
    await tenantClient().tenantConfig.deactivateCommissionRule(id);
  } catch (e) { fail(sdkCode(e, 'commission.save')); }
  done('commission.off');
}

export async function createDeliveryZoneAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const built = buildDeliveryZone({ defaultName: formData.get('defaultName'), pincodes: formData.get('pincodes') });
  if (!built.ok) fail(`zone.${built.error}`);
  try {
    await tenantClient().tenantConfig.createDeliveryZone(built.value, randomUUID());
  } catch (e) { fail(sdkCode(e, 'zone.save')); }
  done('zone');
}

export async function setZoneActiveAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const isActive = String(formData.get('isActive') ?? '') === 'true';
  if (!id) fail('zone.save');
  try {
    await tenantClient().tenantConfig.setDeliveryZoneActive(id, isActive);
  } catch (e) { fail(sdkCode(e, 'zone.save')); }
  done(isActive ? 'zone.on' : 'zone.off');
}

export async function saveBrandingAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const built = buildBranding({
    displayName: formData.get('displayName'), logoUrl: formData.get('logoUrl'),
    primaryColor: formData.get('primaryColor'), supportEmail: formData.get('supportEmail'),
  });
  if (!built.ok) fail(`branding.${built.error}`);
  try {
    const client = tenantClient();
    for (const s of built.settings) await client.tenantConfig.putSetting(s.key, s.value, randomUUID());
  } catch (e) { fail(sdkCode(e, 'branding.save')); }
  done('branding');
}

export async function saveLanguagesAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const built = buildLanguages(
    { enabled: formData.getAll('enabled').map(String), default: formData.get('default') },
    PLATFORM_LANGUAGES,
  );
  if (!built.ok) fail(`languages.${built.error}`);
  try {
    const client = tenantClient();
    for (const s of built.settings) await client.tenantConfig.putSetting(s.key, s.value, randomUUID());
  } catch (e) { fail(sdkCode(e, 'languages.save')); }
  done('languages');
}
