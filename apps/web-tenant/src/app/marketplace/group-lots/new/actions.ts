'use server';
// apps/web-tenant/src/app/marketplace/group-lots/new/actions.ts · W2631 / W2632 · open a group lot — PC-56 TENANT-11c.
// The review's rules are re-run here (a hand-crafted POST gets the same refusals) and then by the API inside its own
// transaction (product, unit, membership, the fee cap, the appointee's consent; GL number by trigger; audited with ip).
// THE KEY IS THE REVIEW PAGE'S (a double submit opens one lot). The values ride back to the failure page so its retry is a
// review of what was typed.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { CreateGroupLotInput } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { FORM_KEYS, GROUP_LOTS_HREF, NEW_LOT_HREF, carried, createBody, failureCodesFrom, lotEntries, reviewLot } from '../../../../features/group-lots/console';

export async function createLotAction(formData: FormData): Promise<void> {
  await requireSession(NEW_LOT_HREF);
  const values = carried(FORM_KEYS, (k) => formData.get(k));
  const keep = new URLSearchParams(values);
  const entries = lotEntries(values);
  const refusals = reviewLot(entries, new Date());
  if (refusals.length > 0) redirect(`${NEW_LOT_HREF}?step=failure&error=${encodeURIComponent([...new Set(refusals.map((r) => r.code))].join(','))}&${keep.toString()}`);
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let id: string | null = null; let failed: string[] | null = null;
  try { id = (await tenantClient().groupLots.create(createBody(entries) as unknown as CreateGroupLotInput, key)).id; }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown']; }
  if (failed) redirect(`${NEW_LOT_HREF}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(GROUP_LOTS_HREF);
  redirect(`${NEW_LOT_HREF}?step=success&id=${encodeURIComponent(id ?? '')}`);
}
