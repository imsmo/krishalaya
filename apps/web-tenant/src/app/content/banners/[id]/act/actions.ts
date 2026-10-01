'use server';
// apps/web-tenant/src/app/content/banners/[id]/act/actions.ts · the banner mutate chain's act — W2508/W2509 · PC-56
// TENANT-8d. The confirm step asked the API for the verdict and showed the reason box; this posts the act WITH ITS REASON
// under the key the confirm step minted (F-17: a double-click is one act). The server re-takes the verdict on the locked
// row — and, for activate / resume, 0178's activation law inside the transaction (a confirm screen is not a token). The
// reason is dropped from the success URL (6d-5's rule): it is in the banner's row and its audit entry now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../../features/mutate/chain';
import { BANNERS_HREF, bannerHref, isBannerAct } from '../../../../../features/banners/banners';

export async function bannerActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  const act = String(formData.get('act') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const path = `${bannerHref(id)}/act`;
  await requireSession(path);
  if (!id) redirect(BANNERS_HREF);
  const values = { act, reason };
  if (!isBannerAct(act) || reason.length === 0) redirect(`${path}?${carryValues('confirm', values).query}`);
  try {
    await tenantClient().cms.banners.act(id, act, { reason }, key);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'act') : 'act';
    const d = e instanceof SdkError ? (e.details as { refusals?: string[]; missingLanguages?: string[] } | undefined) : undefined;
    const q = new URLSearchParams({ error: code });
    if (d?.refusals?.length) q.set('refusals', d.refusals.join(','));
    if (d?.missingLanguages?.length) q.set('langs', d.missingLanguages.join(','));
    redirect(`${path}?${carryValues('failure', values).query}&${q.toString()}`);
  }
  revalidatePath(BANNERS_HREF); revalidatePath(bannerHref(id));
  redirect(`${path}?${new URLSearchParams({ step: 'success', act }).toString()}`);
}
