'use server';
// apps/web-tenant/src/app/ops/logistics/cold-chain/devices/actions.ts · the cold-chain loggers (PC-56 TENANT-SW-e): register a logger
// in 12's device registry, issue its signing key (returned to the client component ONCE, in this response body only — never a URL, a
// cookie, storage or a log), revoke the active key with a reason. `logistics.devices.manage`.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { ColdSubjectType } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { DEVICES_HREF, isColdSubjectType, isUuid } from '../../../../../features/swe/console';

const code = (e: unknown) => (e instanceof SdkError ? (e.code || 'unknown') : 'unknown');

export async function registerLoggerAction(formData: FormData): Promise<void> {
  await requireSession(DEVICES_HREF);
  const serial = String(formData.get('serial') ?? '').trim().slice(0, 80); const label = String(formData.get('label') ?? '').trim().slice(0, 120);
  try { await tenantClient().coldChain.registerLogger({ serial, label: label || null }, String(formData.get('idempotencyKey') ?? '')); }
  catch (e) { redirect(`${DEVICES_HREF}?error=${encodeURIComponent(code(e))}`); }
  revalidatePath(DEVICES_HREF);
  redirect(`${DEVICES_HREF}?registered=1`);
}

export type IssueKeyResult = { ok: true; key: string | null; hint: string; revokedKeyId: string | null } | { ok: false; codes: string[] };
export async function issueKeyAction(deviceId: string, subjectType: string, subjectId: string, reason: string, idempotencyKey: string): Promise<IssueKeyResult> {
  await requireSession(DEVICES_HREF);
  if (!isUuid(deviceId) || !isColdSubjectType(subjectType) || !isUuid(subjectId)) return { ok: false, codes: ['VALIDATION_FAILED'] };
  try {
    const r = await tenantClient().coldChain.issueKey(deviceId, { subjectType: subjectType as ColdSubjectType, subjectId, reason: reason.trim().slice(0, 500) }, idempotencyKey);
    revalidatePath(DEVICES_HREF);
    return { ok: true, key: r.key, hint: r.hint, revokedKeyId: r.revokedKeyId };
  } catch (e) { return { ok: false, codes: [code(e)] }; }
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  await requireSession(DEVICES_HREF);
  const deviceId = String(formData.get('deviceId') ?? ''); const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  if (!isUuid(deviceId)) redirect(DEVICES_HREF);
  try { await tenantClient().coldChain.revokeKey(deviceId, reason, String(formData.get('idempotencyKey') ?? '')); }
  catch (e) { redirect(`${DEVICES_HREF}?error=${encodeURIComponent(code(e))}`); }
  revalidatePath(DEVICES_HREF);
  redirect(`${DEVICES_HREF}?revoked=1`);
}
