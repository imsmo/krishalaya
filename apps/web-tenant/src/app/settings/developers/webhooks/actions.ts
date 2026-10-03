'use server';
// apps/web-tenant/src/app/settings/developers/webhooks/actions.ts · the webhook writes — PC-56 TENANT-13a.
//
// THE SECRET IS RETURNED IN THE ACTION'S RESPONSE BODY, NEVER IN A URL (F-5). `registerEndpointAction` and `rotateSecretAction` are
// called from client components (AddEndpointChain, RotateSecretConfirm) and RETURN the secret; the component holds it in React state,
// shows it once, and it is gone on navigation. No redirect here carries a secret, an endpoint URL or a developer email. The other acts
// (pause / resume / delete / replay-failed / replay one) are plain form actions that redirect with an outcome CODE only.
// Every write carries the Idempotency-Key the review / confirm page minted. RBAC (api.manage), the guard and the audit live in the API.
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { WebhookRegistrationReview } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import {
  DELIVERIES_HREF, NEW_ENDPOINT_HREF, WEBHOOKS_HREF, actBase, deliveryHref, failureCodesFrom, isAct, isIdemKey, isUuid, replayBase,
} from '../../../../features/webhooks/webhooks';

export interface EndpointInput { url: string; eventTypes: string[]; developerEmail: string }
export type PreviewResult = { ok: true; review: WebhookRegistrationReview } | { ok: false; codes: string[] };
export type RegisterResult =
  | { ok: true; id: string; secret: string | null; secretShown: boolean; secretHint: string; eventTypes: string[] }
  | { ok: false; codes: string[] };
export type RotateResult = { ok: true; secret: string | null; secretShown: boolean; secretHint: string; previousSecretSignsUntil: string } | { ok: false; codes: string[] };

const clean = (i: EndpointInput): EndpointInput => ({
  url: String(i?.url ?? '').trim().slice(0, 600),
  eventTypes: [...new Set((Array.isArray(i?.eventTypes) ? i.eventTypes : []).map((e) => String(e).trim()).filter((e) => /^[a-z][a-z0-9_.]{1,59}$/.test(e)))].slice(0, 60),
  developerEmail: String(i?.developerEmail ?? '').trim().slice(0, 300),
});
const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown']; };

/** W2833 — the review (live guard verdict). Writes nothing. */
export async function previewEndpointAction(input: EndpointInput): Promise<PreviewResult> {
  await requireSession(NEW_ENDPOINT_HREF);
  try { return { ok: true, review: await tenantClient().webhooks.preview(clean(input)) }; }
  catch (e) { return { ok: false, codes: codesOf(e) }; }
}

/** W2834 — register; the secret comes back in THIS return value, once. */
export async function registerEndpointAction(input: EndpointInput, idempotencyKey: string): Promise<RegisterResult> {
  await requireSession(NEW_ENDPOINT_HREF);
  const key = isIdemKey(idempotencyKey) ? idempotencyKey : randomUUID();
  try {
    const r = await tenantClient().webhooks.register(clean(input), key);
    revalidatePath(WEBHOOKS_HREF);
    return { ok: true, id: r.id, secret: r.secret, secretShown: r.secretShown, secretHint: r.secretHint, eventTypes: r.eventTypes };
  } catch (e) { return { ok: false, codes: codesOf(e) }; }
}

/** W2837 (rotate) — the new secret comes back in THIS return value, once; the old one signs for 24 h. */
export async function rotateSecretAction(id: string, reason: string, idempotencyKey: string): Promise<RotateResult> {
  await requireSession(WEBHOOKS_HREF);
  if (!isUuid(id)) return { ok: false, codes: ['NOT_FOUND'] };
  const key = isIdemKey(idempotencyKey) ? idempotencyKey : randomUUID();
  try {
    const r = await tenantClient().webhooks.rotateSecret(id, String(reason ?? '').trim().slice(0, 400), key);
    revalidatePath(WEBHOOKS_HREF);
    return { ok: true, secret: r.secret, secretShown: r.secretShown, secretHint: r.secretHint, previousSecretSignsUntil: r.previousSecretSignsUntil };
  } catch (e) { return { ok: false, codes: codesOf(e) }; }
}

/** W2837 / W2838 — pause · resume · delete · replay-failed. Redirects with an outcome code only. */
export async function endpointActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '');
  const base = actBase(id);
  await requireSession(base);
  if (!isUuid(id) || !isAct(act) || act === 'rotate') redirect(WEBHOOKS_HREF);
  const key = String(formData.get('idempotencyKey') ?? '');
  if (!isIdemKey(key)) redirect(`${base}?step=failure&act=${act}&error=unknown`);
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 400);
  const c = tenantClient();
  let failed: string[] | null = null; let moved = 0;
  try {
    const r = act === 'pause' ? await c.webhooks.pause(id, reason, key)
      : act === 'resume' ? await c.webhooks.resume(id, reason, key)
      : act === 'replay-failed' ? await c.webhooks.replayFailed(id, reason, key)
      : await c.webhooks.remove(id, reason, key);
    moved = r.moved;
  } catch (e) { failed = codesOf(e); }
  revalidatePath(WEBHOOKS_HREF); revalidatePath(DELIVERIES_HREF);
  if (failed) redirect(`${base}?step=failure&act=${act}&error=${encodeURIComponent(failed.join(','))}`);
  redirect(`${base}?step=success&act=${act}&moved=${moved}`);
}

/** W2830 / W2831 — replay ONE delivery (original payload, fresh signature). */
export async function replayDeliveryAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = replayBase(id);
  await requireSession(base);
  if (!isUuid(id)) redirect(DELIVERIES_HREF);
  const key = String(formData.get('idempotencyKey') ?? '');
  if (!isIdemKey(key)) redirect(`${base}?step=failure&error=unknown`);
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 400);
  let failed: string[] | null = null;
  try { await tenantClient().webhooks.replay(id, reason, key); }
  catch (e) { failed = codesOf(e); }
  revalidatePath(DELIVERIES_HREF); revalidatePath(deliveryHref(id));
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}`);
  redirect(`${base}?step=success`);
}
