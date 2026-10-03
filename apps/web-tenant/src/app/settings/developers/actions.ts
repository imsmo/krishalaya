'use server';
// apps/web-tenant/src/app/settings/developers/actions.ts · the API key writes — PC-56 TENANT-13c (W2488–W2494).
//
// THE KEY IS RETURNED IN THE ACTION'S RESPONSE BODY, NEVER IN A URL. `createKeyAction` is called from the client component CreateKeyChain
// and RETURNS the key; the component holds it in React state, shows it once, and it is gone on navigation. No redirect here carries a
// key. Revoke and the proposal acts are plain form actions that redirect with an outcome CODE only. Every write carries the
// Idempotency-Key its page minted. RBAC (api.manage), the plan gate, the checker trigger and the audit live in the API.
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { ApiKeyDraft, ApiKeyReview, ApiKeyStatus } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { DEVELOPERS_HREF, NEW_KEY_HREF, failureCodesFrom, isIdemKey, isUuid, keyProposalHref, revokeBase } from '../../../features/api-keys/api-keys';

export type KeyPreviewResult = { ok: true; review: ApiKeyReview } | { ok: false; codes: string[] };
export type KeyCreateResult =
  | { ok: true; id: string; keyPrefix: string; key: string | null; keyShown: boolean; status: ApiKeyStatus; proposalId: string | null }
  | { ok: false; codes: string[] };

const clean = (d: Partial<ApiKeyDraft>): ApiKeyDraft => ({
  name: String(d?.name ?? '').trim().slice(0, 200),
  scopes: [...new Set((Array.isArray(d?.scopes) ? d.scopes : []).map((s) => String(s).trim()).filter((s) => /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/.test(s)))].slice(0, 40),
  ratePerHour: Number.isFinite(Number(d?.ratePerHour)) ? Math.trunc(Number(d?.ratePerHour)) : undefined,
  expiresAt: d?.expiresAt ? String(d.expiresAt).slice(0, 40) : null,
  reason: String(d?.reason ?? '').trim().slice(0, 600),
});
const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown']; };

/** W2489 — the review. Writes nothing. */
export async function previewKeyAction(draft: Partial<ApiKeyDraft>): Promise<KeyPreviewResult> {
  await requireSession(NEW_KEY_HREF);
  try { return { ok: true, review: await tenantClient().apiKeys.preview(clean(draft)) }; }
  catch (e) { return { ok: false, codes: codesOf(e) }; }
}

/** W2490 — issue; the key comes back in THIS return value, once. */
export async function createKeyAction(draft: Partial<ApiKeyDraft>, idempotencyKey: string): Promise<KeyCreateResult> {
  await requireSession(NEW_KEY_HREF);
  const key = isIdemKey(idempotencyKey) ? idempotencyKey : randomUUID();
  try {
    const r = await tenantClient().apiKeys.create(clean(draft), key);
    revalidatePath(DEVELOPERS_HREF);
    return { ok: true, id: r.id, keyPrefix: r.keyPrefix, key: r.key, keyShown: r.keyShown, status: r.status, proposalId: r.proposalId };
  } catch (e) { return { ok: false, codes: codesOf(e) }; }
}

/** W2493 / W2494 — revoke (reason required). Redirects with an outcome code only. */
export async function revokeKeyAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = revokeBase(id);
  await requireSession(base);
  if (!isUuid(id)) redirect(DEVELOPERS_HREF);
  const k = String(formData.get('idempotencyKey') ?? '');
  if (!isIdemKey(k)) redirect(`${base}?step=failure&error=unknown`);
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 300);
  let failed: string[] | null = null;
  try { await tenantClient().apiKeys.revoke(id, reason, k); } catch (e) { failed = codesOf(e); }
  revalidatePath(DEVELOPERS_HREF);
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}`);
  redirect(`${base}?step=success`);
}

/** Confirm (a different administrator) or refuse (with a reason) a waiting key's proposal. */
export async function keyProposalAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '');
  const base = keyProposalHref(id);
  await requireSession(base);
  if (!isUuid(id) || (act !== 'confirm' && act !== 'refuse')) redirect(DEVELOPERS_HREF);
  const k = String(formData.get('idempotencyKey') ?? '');
  if (!isIdemKey(k)) redirect(`${base}?step=failure&act=${act}&error=unknown`);
  let failed: string[] | null = null;
  try {
    if (act === 'confirm') await tenantClient().apiKeys.confirm(id, k);
    else await tenantClient().apiKeys.refuse(id, String(formData.get('reason') ?? '').trim().slice(0, 500), k);
  } catch (e) { failed = codesOf(e); }
  revalidatePath(DEVELOPERS_HREF);
  if (failed) redirect(`${base}?step=failure&act=${act}&error=${encodeURIComponent(failed.join(','))}`);
  redirect(`${base}?step=success&act=${act}`);
}
