'use server';
// apps/web-tenant/src/app/ops/logistics/cold-chain/breaches/actions.ts · W2534 — queue the breaches export on the 6e-2 plane (the file
// is UNSIGNED and its receipt says so) · PC-56 TENANT-SW-e.
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { BREACHES_HREF, coldExportHref } from '../../../../../features/swe/console';

export async function exportBreachesAction(formData: FormData): Promise<void> {
  await requireSession(BREACHES_HREF);
  const months = Math.min(24, Math.max(1, Number(formData.get('months') ?? 12) || 12));
  let id = '';
  try { id = (await tenantClient().coldChain.exportBreaches({ months }, String(formData.get('idempotencyKey') || randomUUID()))).id; }
  catch (e) { redirect(`${BREACHES_HREF}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'unknown') : 'unknown')}`); }
  redirect(coldExportHref(id));
}
