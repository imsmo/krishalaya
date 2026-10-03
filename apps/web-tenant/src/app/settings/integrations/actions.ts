'use server';
// apps/web-tenant/src/app/settings/integrations/actions.ts · the provider-change writes — PC-56 TENANT-13c (W2643–W2649).
//
// THE CREDENTIAL NEVER TRAVELS IN A URL. `proposeIntegrationAction` is called from the client component ConnectChain with the credential
// in its ARGUMENTS (a server-action body, never a query string); the API verifies it against the provider in shadow and holds it sealed
// on the proposal — it is never echoed back. Disconnect and the proposal acts are form actions that redirect with an outcome CODE only.
// Every write carries the Idempotency-Key its page minted (F-21). RBAC (api.manage / tenant.settings), the ownable allow-list, the
// checker trigger and the audit live in the API. 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { IntegrationKind, IntegrationProposalInput, IntegrationReview } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { CONNECT_HREF, INTEGRATIONS_HREF, failureCodesFrom, isIdemKey, isProviderCode, isUuid, proposalHref } from '../../../features/integrations/integrations';

export interface ConnectInput { providerCode: string; kind: 'connect' | 'rotate'; credential: Record<string, string>; reason: string }
export type IntegrationPreviewResult = { ok: true; review: IntegrationReview } | { ok: false; codes: string[]; verifyClass?: string | null };
export type IntegrationProposeResult = { ok: true; id: string; credentialHint: string | null } | { ok: false; codes: string[]; verifyClass: string | null };

const clean = (i: ConnectInput): IntegrationProposalInput => ({
  providerCode: isProviderCode(i?.providerCode) ? i.providerCode : '',
  kind: i?.kind === 'rotate' ? 'rotate' : 'connect',
  credential: Object.fromEntries(Object.entries(i?.credential ?? {}).filter(([k, v]) => /^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(k) && typeof v === 'string').slice(0, 8).map(([k, v]) => [k, String(v).slice(0, 600)])),
  reason: String(i?.reason ?? '').trim().slice(0, 600),
});
const fail = (e: unknown) => {
  const err = e instanceof SdkError ? e : null;
  const cls = (err?.details as { errorClass?: unknown } | undefined)?.errorClass;
  return { codes: err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown'], verifyClass: typeof cls === 'string' && /^[a-z]{2,10}$/.test(cls) ? cls : null };
};

/** W2644 — the review (no provider call, nothing stored). */
export async function previewIntegrationAction(input: ConnectInput): Promise<IntegrationPreviewResult> {
  await requireSession(CONNECT_HREF);
  try { return { ok: true, review: await tenantClient().integrations.preview(clean(input)) }; }
  catch (e) { return { ok: false, ...fail(e) }; }
}

/** W2645 — propose; the credential is verified in shadow by the API before anything is stored. */
export async function proposeIntegrationAction(input: ConnectInput, idempotencyKey: string): Promise<IntegrationProposeResult> {
  await requireSession(CONNECT_HREF);
  const key = isIdemKey(idempotencyKey) ? idempotencyKey : randomUUID();
  try {
    const r = await tenantClient().integrations.propose(clean(input), key);
    revalidatePath(INTEGRATIONS_HREF);
    return { ok: true, id: r.id, credentialHint: r.credentialHint };
  } catch (e) { return { ok: false, ...fail(e) }; }
}

/** W2647 — propose a disconnect (reason required); redirects to the proposal card or the failure screen with codes only. */
export async function proposeDisconnectAction(formData: FormData): Promise<void> {
  const provider = String(formData.get('provider') ?? '');
  const base = `${INTEGRATIONS_HREF}/disconnect?provider=${encodeURIComponent(provider)}`;
  await requireSession(INTEGRATIONS_HREF);
  if (!isProviderCode(provider)) redirect(INTEGRATIONS_HREF);
  const k = String(formData.get('idempotencyKey') ?? '');
  if (!isIdemKey(k)) redirect(`${base}&step=failure&error=unknown`);
  let id: string | null = null; let failed: string[] | null = null;
  try {
    const kind: IntegrationKind = 'disconnect';
    id = (await tenantClient().integrations.propose({ providerCode: provider, kind, reason: String(formData.get('reason') ?? '').trim().slice(0, 600) }, k)).id;
  } catch (e) { failed = fail(e).codes; }
  revalidatePath(INTEGRATIONS_HREF);
  if (failed || !id) redirect(`${base}&step=failure&error=${encodeURIComponent((failed ?? ['unknown']).join(','))}`);
  redirect(`${proposalHref(id)}?step=confirm&proposed=1`);
}

/** W2648 / W2649 — confirm (a different administrator: verify again → vault → write) or refuse (with a reason). */
export async function integrationProposalAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '');
  const base = proposalHref(id);
  await requireSession(base);
  if (!isUuid(id) || (act !== 'confirm' && act !== 'refuse')) redirect(INTEGRATIONS_HREF);
  const k = String(formData.get('idempotencyKey') ?? '');
  if (!isIdemKey(k)) redirect(`${base}?step=failure&act=${act}&error=unknown`);
  let failed: string[] | null = null; let outcome = 'applied';
  try {
    if (act === 'confirm') outcome = (await tenantClient().integrations.confirm(id, k)).status;
    else { await tenantClient().integrations.refuse(id, String(formData.get('reason') ?? '').trim().slice(0, 500), k); outcome = 'refused'; }
  } catch (e) { failed = fail(e).codes; }
  revalidatePath(INTEGRATIONS_HREF);
  if (failed) redirect(`${base}?step=failure&act=${act}&error=${encodeURIComponent(failed.join(','))}`);
  redirect(`${base}?step=success&act=${act}&outcome=${outcome === 'verify_failed' ? 'verify_failed' : outcome === 'refused' ? 'refused' : 'applied'}`);
}
