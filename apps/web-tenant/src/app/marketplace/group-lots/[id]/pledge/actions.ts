'use server';
// apps/web-tenant/src/app/marketplace/group-lots/[id]/pledge/actions.ts · W2631 / W2632 · pledge — PC-56 TENANT-11c.
// `{ farmerUserId?, quantity }`: as self (the default), or FOR a member (this lot's coordinator / tenant_admin — the API decides
// on the locked lot). The review's rules are re-run here; the key is the review page's (a double submit adds once).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { GROUP_LOTS_HREF, PLEDGE_KEYS, carried, failureCodesFrom, isUuid, lotHref, reviewPledge } from '../../../../../features/group-lots/console';

export async function pledgeAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${lotHref(id)}/pledge`;
  await requireSession(base);
  if (!isUuid(id)) redirect(GROUP_LOTS_HREF);
  const values = carried(PLEDGE_KEYS, (k) => formData.get(k));
  const keep = new URLSearchParams(values);
  const refusals = reviewPledge(values);
  if (refusals.length > 0) redirect(`${base}?step=failure&error=${encodeURIComponent(refusals.map((r) => r.code).join(','))}&${keep.toString()}`);
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let failed: string[] | null = null; let autoReady = false;
  try {
    const r = await tenantClient().groupLots.pledge(id, { quantity: values.quantity, ...(values.onBehalf === '1' ? { farmerUserId: values.farmerUserId } : {}) }, key);
    autoReady = !!r.autoReady;
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(lotHref(id)); revalidatePath(GROUP_LOTS_HREF);
  redirect(`${base}?step=success${autoReady ? '&ready=1' : ''}`);
}
