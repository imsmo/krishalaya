'use server';
// apps/web-tenant/src/app/insights/wastage/act/actions.ts · W2826 → W2827 / W2828 — "re-run backfill" from recorded facts (PC-56 TENANT-SW-f).
// The API names every source row in a loss state through the database's writer; a recorded one is `exists`. Idempotent; audited with the
// reason. A typed loss is never offered (facts only).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { WASTAGE_HREF } from '../../../../features/swf/console';

export async function rerunWastageAction(formData: FormData): Promise<void> {
  const base = `${WASTAGE_HREF}/act`;
  await requireSession(base);
  const reason = String(formData.get('reason') ?? '').trim();
  const carry = new URLSearchParams({ reason });
  try {
    const r = await tenantClient().insights.rerunWastage(reason, String(formData.get('key') ?? randomUUID()));
    carry.set('written', String(r.written)); carry.set('existing', String(r.existing));
  } catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(WASTAGE_HREF);
  carry.set('step', 'success');
  redirect(`${base}?${carry.toString()}`);
}
