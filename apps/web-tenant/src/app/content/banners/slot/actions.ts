'use server';
// apps/web-tenant/src/app/content/banners/slot/actions.ts · the banners-mutate chain's act — W2515/W2516 · PC-56 TENANT-8d.
// Moves one banner one place inside its placement under the key the confirm step minted; the server locks the slot,
// re-judges the move against the order AS IT STANDS (7b's rule: a confirm screen is not a token) and audits it with the
// order before and after.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';
import { BANNERS_HREF, BANNER_SLOT_HREF, bannerHref, isDirection } from '../../../../features/banners/banners';

export async function bannerSlotAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  const direction = String(formData.get('direction') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  await requireSession(BANNER_SLOT_HREF);
  const values = { id, direction, reason };
  if (!id || !isDirection(direction) || reason.length === 0) redirect(`${BANNER_SLOT_HREF}?${carryValues('confirm', values).query}`);
  try {
    await tenantClient().cms.banners.slotMove({ id, direction, reason }, key);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'move') : 'move';
    redirect(`${BANNER_SLOT_HREF}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(BANNERS_HREF); revalidatePath(bannerHref(id));
  redirect(`${BANNER_SLOT_HREF}?${new URLSearchParams({ step: 'success', id, direction }).toString()}`);
}
