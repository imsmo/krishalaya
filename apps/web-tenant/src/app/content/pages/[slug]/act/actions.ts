'use server';
// apps/web-tenant/src/app/content/pages/[slug]/act/actions.ts · the page mutate chain's act — W2701/W2702 · PC-56
// TENANT-8c. The confirm step asked the API for the verdict and showed the reason box (and, for archive, the vocabulary);
// this posts the act WITH ITS REASON under the key the confirm step minted (F-17: a double-click is one act). The server
// re-takes the verdict on the locked row under the slug's lock — a confirm screen is not a token. The reason is dropped
// from the success URL (6d-5's rule): it is in the audit row now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../../features/mutate/chain';
import { FAQ_HREF, PAGES_HREF, isPageAct, pageHref } from '../../../../../features/pages/pages';

export async function pageActAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '').trim();
  const id = String(formData.get('id') ?? '').trim();
  const act = String(formData.get('act') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const archiveReason = String(formData.get('archiveReason') ?? '').trim() || undefined;
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const path = `${pageHref(slug)}/act`;
  await requireSession(path);
  if (!slug || !id) redirect(PAGES_HREF);
  const values = { act, reason, archiveReason, id };
  if (!isPageAct(act) || reason.length === 0) redirect(`${path}?${carryValues('confirm', values).query}`);
  let out: { id: string; version: number };
  try {
    out = await tenantClient().cms.pages.act(id, act, { reason, archiveReason }, key);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'act') : 'act';
    redirect(`${path}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(PAGES_HREF); revalidatePath(FAQ_HREF); revalidatePath(pageHref(slug));
  redirect(`${path}?${new URLSearchParams({ step: 'success', act, id: out.id, version: String(out.version) }).toString()}`);
}
