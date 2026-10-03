'use server';
// apps/web-tenant/src/app/ops/logistics/zones/new/actions.ts · W2848–W2851 "New zone (checker)" — the form chain's one write (PC-56 TENANT-SW-a):
// a create PROPOSAL. A different tenant_admin confirms it on the zones screen; the API refuses a fee definition W150 never approved.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { ZONES_HREF, parsePincodes, readZoneDraft } from '../../../../../features/swa/console';

export async function proposeZoneAction(formData: FormData): Promise<void> {
  const base = `${ZONES_HREF}/new`;
  await requireSession(base);
  const q: Record<string, string> = {}; formData.forEach((v, k) => { if (typeof v === 'string') q[k] = v; });
  const d = readZoneDraft(q);
  const carry = new URLSearchParams(Object.entries(d).filter(([, v]) => v !== '') as Array<[string, string]>);
  let id = '';
  try {
    id = (await tenantClient().tenantConfig.proposeZone({ kind: 'create', defaultName: d.defaultName, pincodes: parsePincodes(d.pincodes).pins, regionIds: [],
      chargeDefinitionId: d.chargeDefinitionId || null, reason: d.reason }, String(q.idempotencyKey || ''))).id;
  } catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'generic') : 'generic'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(ZONES_HREF);
  redirect(`${base}?step=success&proposalId=${encodeURIComponent(id)}`);
}
