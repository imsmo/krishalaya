'use server';
// apps/web-tenant/src/app/content/banners/new/actions.ts · the banner form chain's submit — W2512/W2513 (banners), W2505/
// W2506 (banner) · PC-56 TENANT-8d.
//
// Runs only from the REVIEW step, and the review has already asked the API every question this action could ask — so it
// validates nothing beyond presence (6d-4's contract). The same body the review saw goes to the writer, which locks the
// banner and its slot, runs the same review again and refuses with the same codes if anything changed underneath — and
// with `CMS_BANNER_CHANGED` (409) when an edit's banner is no longer the one the review described (`expect`).
//
// THE IDEMPOTENCY-KEY IS THE FORM'S (F-17): minted when the review rendered, carried in a hidden input. SUCCESS drops the
// words and the reason from the URL: they are in the banner and its audit row now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/forms/chain';
import { BANNERS_HREF, MAX_CARRIED_LENGTH_BANNER, bannerHref, chainPath, type BannerChain } from '../../../../features/banners/banners';

const RESERVED = new Set(['chain', 'routeId', 'idempotencyKey', 'expect']);
const FIELD_RE = /^(placement|mediaId|groupKey|targetUrl|roles|regions|startsDate|startsTime|endsDate|endsTime|reason|(headline|body|cta)_[a-z]{2,3})$/;

export async function saveBannerAction(formData: FormData): Promise<void> {
  const chain: BannerChain = String(formData.get('chain') ?? '') === 'banner' ? 'banner' : 'banners';
  const routeId = String(formData.get('routeId') ?? '').trim() || null;
  const path = chainPath(chain, routeId);
  await requireSession(path);
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (RESERVED.has(k) || !FIELD_RE.test(k) || typeof v !== 'string') continue;
    const s = v.trim();
    if (s.length > 0) values[k] = s;
  }
  if (!values.placement || !values.mediaId) redirect(`${path}?${carryValues('review', values, MAX_CARRIED_LENGTH_BANNER).query}`);
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const expect = String(formData.get('expect') ?? '').trim() || undefined;

  let saved: { id: string; missingLanguages: string[] };
  try {
    const c = tenantClient().cms.banners;
    saved = chain === 'banner' && routeId ? await c.update(routeId, { ...values, intent: 'edit', expect }, key) : await c.create({ ...values, intent: 'new' }, key);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    redirect(`${path}?${carryValues('failure', values, MAX_CARRIED_LENGTH_BANNER).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(BANNERS_HREF); revalidatePath(bannerHref(saved.id));
  const q = new URLSearchParams({ step: 'success', created: saved.id });
  if (saved.missingLanguages.length) q.set('missing', saved.missingLanguages.join(','));
  redirect(`${path}?${q.toString()}`);
}
