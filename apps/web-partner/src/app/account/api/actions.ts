'use server';
// apps/web-partner/src/app/account/api/actions.ts · PC-56 PARTNER-1b · founder D1 — the ONE write of the keys page: revoke one of this partner's
// keys (`POST /v1/partner/keys/:id/revoke`, `partner.keys.revoke` — the API decides who may; 0227's definer refuses another partner's key as
// "not found"). The Idempotency-Key was minted at render and comes back from the confirm step's hidden field; the reason comes from the form
// body and NEVER enters a URL: the outcome redirects to `?act=revoke&id=…&state=success` or `&state=failure&code=CODE`.
// 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { keyReasonOk } from '../../../features/partner1/keys';

const codeOf = (e: unknown) => (e instanceof SdkError ? (e.status === 429 ? 'RATE_LIMITED' : e.code) : 'unknown');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function revokeKeyAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = String(formData.get('id') ?? ''); const reason = String(formData.get('reason') ?? ''); const key = String(formData.get('idempotencyKey') ?? '');
  if (!UUID.test(id)) redirect('/account/api');
  const back = `/account/api?act=revoke&id=${encodeURIComponent(id)}`;
  if (!keyReasonOk(reason)) redirect(`${back}&state=failure&code=PARTNER_KEY_REASON_REQUIRED`);
  if (!key) redirect(`${back}&state=failure&code=PARTNER_IDEMPOTENCY_KEY_REQUIRED`);
  try {
    await partnerClient().partner.keys.revoke(id, { reason }, key);
  } catch (e) {
    redirect(`${back}&state=failure&code=${encodeURIComponent(codeOf(e))}`);
  }
  redirect(`${back}&state=success`);
}
