'use server';
// apps/web-tenant/src/app/money/commission/act/actions.ts · W2431–W2433 — the commission MUTATE chain's writes (PC-56 TENANT-SW-a): confirm a
// proposal (a different tenant_admin — the database is the wall), refuse / withdraw it (reason), or propose the deactivation of one of the
// tenant's own rules from an IST midnight ≥ 7 days out (reason). Keyed by the confirm page's idempotency key.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { COMMISSION_HREF, isCommissionAct, isUuid, isYmd } from '../../../../features/swa/console';
import { SEEN_FIELD, staleHref, verifyBeforeWrite } from '../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../features/mutate/verify-fields';

export async function commissionActAction(formData: FormData): Promise<void> {
  const base = `${COMMISSION_HREF}/act`;
  await requireSession(base);
  const act = String(formData.get('act') ?? ''); const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim(); const effectiveFrom = String(formData.get('effectiveFrom') ?? '');
  const key = String(formData.get('idempotencyKey') ?? '');
  if (!isCommissionAct(act) || !isUuid(id)) redirect(COMMISSION_HREF);
  const carry = new URLSearchParams({ act, id, ...(reason ? { reason } : {}), ...(isYmd(effectiveFrom) ? { effectiveFrom } : {}) });
  let auditId = id;
  // [PC-56 TENANT-SW-f · W318 §3] VERIFY BEFORE WRITE: the row this act's confirm step showed, re-read now — a row that moved since is
  // refused STALE_ROW with the diff (field · was · now) and nothing is written; the operator re-checks on today's row.
  const seen = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => (act === 'deactivate' ? await tenantClient().tenantConfig.commissionPolicy() : await tenantClient().tenantConfig.commissionProposal(id)) as never);
  void VERIFY_FIELDS.commissionProposal;
  if (!seen.ok) redirect(staleHref(base, Object.fromEntries(carry), seen));
  try {
    const c = tenantClient().tenantConfig;
    if (act === 'confirm') await c.confirmCommissionProposal(id, key);
    else if (act === 'refuse') await c.refuseCommissionProposal(id, reason, key);
    else auditId = (await c.proposeCommissionDeactivation(id, { effectiveFrom, reason }, key)).id;
  } catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'generic') : 'generic'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(COMMISSION_HREF);
  carry.set('step', 'success'); carry.set('auditId', auditId);
  redirect(`${base}?${carry.toString()}`);
}
