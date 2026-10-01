'use server';
// apps/web-tenant/src/app/content/pages/new/actions.ts · the page form chain's submit — W2698/W2699 (page), W2705/W2706
// (pages), W2607/W2608 (faq) · PC-56 TENANT-8c.
//
// Runs only from the REVIEW step, and the review has already asked the API every question this action could ask — so it
// validates nothing beyond presence (6d-4's contract). The same body the review saw goes to the writer, which takes the
// slug's lock, runs the same review again and refuses with the same codes if anything changed underneath — and with
// `CMS_PAGE_CHANGED` (409) when the write is no longer the one the review described (`expect`: a colleague wrote first).
//
// THE IDEMPOTENCY-KEY IS THE FORM'S (F-17): minted when the review rendered, carried in a hidden input. SUCCESS drops the
// body and the reason from the URL: they are in the version and its audit row now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/forms/chain';
import { FAQ_HREF, MAX_CARRIED_LENGTH_PAGE, PAGES_HREF, PAGE_FIELDS, chainIntent, chainPath, pageHref, type PageChain } from '../../../../features/pages/pages';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };
const asChain = (v: string | undefined): PageChain => (v === 'page' || v === 'faq' ? v : 'pages');

export async function savePageAction(formData: FormData): Promise<void> {
  const chain = asChain(opt(formData.get('chain')));
  const routeSlug = opt(formData.get('routeSlug')) ?? null;
  const path = chainPath(chain, routeSlug);
  await requireSession(path);
  const values: Record<string, string | undefined> = {};
  for (const f of PAGE_FIELDS) values[f] = opt(formData.get(f));
  if (!values.slug || !values.body) redirect(`${path}?${carryValues('review', values, MAX_CARRIED_LENGTH_PAGE).query}`);
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const expect = opt(formData.get('expect'));

  let saved: { id: string; slug: string; version: number; needsChecker: boolean };
  try {
    saved = await tenantClient().cms.pages.create({ ...values, intent: chainIntent(chain), expect }, key);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    redirect(`${path}?${carryValues('failure', values, MAX_CARRIED_LENGTH_PAGE).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(PAGES_HREF); revalidatePath(FAQ_HREF); revalidatePath(pageHref(saved.slug));
  const q = new URLSearchParams({ step: 'success', created: saved.id, version: String(saved.version), createdSlug: saved.slug, checker: saved.needsChecker ? '1' : '0' });
  redirect(`${path}?${q.toString()}`);
}
