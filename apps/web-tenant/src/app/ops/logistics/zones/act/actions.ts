'use server';
// apps/web-tenant/src/app/ops/logistics/zones/act/actions.ts · W233 — the zone MUTATE chain's writes (PC-56 TENANT-SW-a): propose a fee
// re-point / deactivation / re-activation of a zone (logistics.zones.manage), confirm a proposal (a different tenant_admin — the database is
// the wall) or refuse / withdraw one (reason). Keyed by the confirm page's idempotency key.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { ZONES_HREF, isUuid, isZoneAct } from '../../../../../features/swa/console';
import { SEEN_FIELD, staleHref, verifyBeforeWrite } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';

export async function zoneActAction(formData: FormData): Promise<void> {
  const base = `${ZONES_HREF}/act`;
  await requireSession(base);
  const act = String(formData.get('act') ?? ''); const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim(); const def = String(formData.get('chargeDefinitionId') ?? '');
  const key = String(formData.get('idempotencyKey') ?? '');
  if (!isZoneAct(act) || !isUuid(id)) redirect(ZONES_HREF);
  const carry = new URLSearchParams({ act, id, ...(reason ? { reason } : {}), ...(def ? { chargeDefinitionId: def } : {}) });
  let auditId = id; let kind = '';
  // [PC-56 TENANT-SW-f · W318 §3] VERIFY BEFORE WRITE: the row this act's confirm step showed, re-read now — a row that moved since is
  // refused STALE_ROW with the diff (field · was · now) and nothing is written; the operator re-checks on today's row.
  const seen = await verifyBeforeWrite(formData.get(SEEN_FIELD), async () => (act === 'confirm' || act === 'refuse' ? await tenantClient().tenantConfig.zoneProposal(id) : await tenantClient().tenantConfig.getDeliveryZone(id)) as never);
  void VERIFY_FIELDS.zoneProposal;
  if (!seen.ok) redirect(staleHref(base, Object.fromEntries(carry), seen));
  try {
    const c = tenantClient().tenantConfig;
    if (act === 'confirm') { const p = await c.confirmZoneProposal(id, key); auditId = p.zoneId; kind = p.kind; }
    else if (act === 'refuse') await c.refuseZoneProposal(id, reason, key);
    else if (act === 'repoint') auditId = (await c.proposeZone({ kind: 'repoint_fee', zoneId: id, chargeDefinitionId: isUuid(def) ? def : null, reason }, key)).id;
    else auditId = (await c.proposeZone({ kind: act, zoneId: id, reason }, key)).id;
  } catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'generic') : 'generic'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(ZONES_HREF);
  carry.set('step', 'success'); carry.set('auditId', auditId); if (kind) carry.set('kind', kind);
  redirect(`${base}?${carry.toString()}`);
}
