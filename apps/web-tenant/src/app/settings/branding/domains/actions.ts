'use server';
// apps/web-tenant/src/app/settings/branding/domains/actions.ts · the writes of W192 and its chains — PC-56 TENANT-13d.
//   • addDomainAction — W2593 / W2594: add a custom claim (keyed; plan first, reserved, claimed elsewhere — all in the API). Success shows the
//     exact two DNS records again and "we check every 5 minutes".
//   • proposeDomainAction — W2595 → W2596 / W2597: make primary / remove (a successor named for a primary) — a PROPOSAL.
//   • recheckDomainAction — re-check now (once a minute; DNS through the platform's pinned resolvers).
//   • domainProposalActAction — a SECOND administrator confirms (applied in the same transaction) or refuses.
// The domain name is not a secret (canon: "DNS instructions are safe to share with your IT person"), so values may ride the URL.
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { DOMAINS_HREF, DOMAIN_ACT_HREF, DOMAIN_NEW_HREF, domainProposalHref, failureCodesFrom, isIdemKey, isUuid } from '../../../../features/branding/branding';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown']; };
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

export async function addDomainAction(formData: FormData): Promise<void> {
  await requireSession(DOMAIN_NEW_HREF);
  const domain = String(formData.get('domain') ?? '').trim().slice(0, 255);
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const idem = String(formData.get('idempotencyKey') ?? '');
  let failed: string[] | null = null; let id = '';
  try { id = (await tenantClient().domains.add({ domain, reason }, isIdemKey(idem) ? idem : randomUUID())).id; }
  catch (e) { failed = codesOf(e); }
  revalidatePath(DOMAINS_HREF);
  if (failed) redirect(`${DOMAIN_NEW_HREF}?${qs({ domain, reason, step: 'failure', error: failed.join(',') })}`);
  redirect(`${DOMAIN_NEW_HREF}?${qs({ step: 'success', id })}`);
}

export async function proposeDomainAction(formData: FormData): Promise<void> {
  await requireSession(DOMAIN_ACT_HREF);
  const kind = String(formData.get('kind') ?? '') === 'remove' ? 'remove' : 'make_primary';
  const domainId = String(formData.get('domainId') ?? '');
  const successor = String(formData.get('successorDomainId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const idem = String(formData.get('idempotencyKey') ?? '');
  if (!isUuid(domainId)) redirect(DOMAINS_HREF);
  const back = { kind, domain: domainId, reason, ...(isUuid(successor) ? { successor } : {}) };
  let failed: string[] | null = null; let id = '';
  try {
    id = (await tenantClient().domains.propose({ kind, domainId, successorDomainId: isUuid(successor) ? successor : null, reason }, isIdemKey(idem) ? idem : randomUUID())).id;
  } catch (e) { failed = codesOf(e); }
  revalidatePath(DOMAINS_HREF);
  if (failed) redirect(`${DOMAIN_ACT_HREF}?${qs({ ...back, step: 'failure', error: failed.join(',') })}`);
  redirect(`${DOMAIN_ACT_HREF}?${qs({ kind, domain: domainId, step: 'success', proposal: id })}`);
}

export async function recheckDomainAction(formData: FormData): Promise<void> {
  await requireSession(DOMAINS_HREF);
  const domainId = String(formData.get('domainId') ?? '');
  if (!isUuid(domainId)) redirect(DOMAINS_HREF);
  let failed: string[] | null = null; let outcome = '';
  try { outcome = (await tenantClient().domains.recheck(domainId)).outcome; }
  catch (e) { failed = codesOf(e); }
  revalidatePath(DOMAINS_HREF);
  if (failed) redirect(`${DOMAIN_ACT_HREF}?${qs({ kind: 'recheck', domain: domainId, step: 'failure', error: failed.join(',') })}`);
  redirect(`${DOMAIN_ACT_HREF}?${qs({ kind: 'recheck', domain: domainId, step: 'success', outcome: /^[a-z]{4,10}$/.test(outcome) ? outcome : 'skipped' })}`);
}

export async function domainProposalActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '') === 'refuse' ? 'refuse' : 'confirm';
  await requireSession(DOMAINS_HREF);
  if (!isUuid(id)) redirect(DOMAINS_HREF);
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const idem = String(formData.get('idempotencyKey') ?? '');
  const key = isIdemKey(idem) ? idem : randomUUID();
  let failed: string[] | null = null; let entity = '';
  try {
    if (act === 'confirm') entity = (await tenantClient().domains.confirm(id, key)).audit.entityId;
    else await tenantClient().domains.refuse(id, reason, key);
  } catch (e) { failed = codesOf(e); }
  revalidatePath(DOMAINS_HREF);
  if (failed) redirect(`${domainProposalHref(id, 'failure')}&${qs({ act, error: failed.join(',') })}`);
  redirect(`${domainProposalHref(id, 'success')}&${qs({ act, ...(isUuid(entity) ? { entity } : {}) })}`);
}
