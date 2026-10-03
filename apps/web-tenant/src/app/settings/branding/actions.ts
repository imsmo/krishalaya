'use server';
// apps/web-tenant/src/app/settings/branding/actions.ts · the writes of W191 and its chains — PC-56 TENANT-13d.
//
//   • previewBrandAction / saveBrandDraftAction — the form chain W2793 → W2794 → W2795 / W2796, called from the client designer (the preview
//     updates as you type; only the review and the save reach the API). The draft is saved directly by one administrator, audited
//     before → after; a failing contrast pair may be SAVED (the work is never lost) but never published.
//   • uploadLogoAction — the logo FILE (multipart from the page) sent RAW to the API with its own content type; judged and sanitised there.
//   • proposePublishAction — the mutate chain W2797 → W2798 / W2799: a publish (or a rollback) PROPOSAL; the contrast + logo checks are
//     blocking in the API, and the failure screen names the failing pair and its ratio.
//   • proposalActAction — a SECOND administrator confirms (the database refuses the proposer) — which publishes — or refuses / withdraws.
// Every write carries the Idempotency-Key the page minted. Redirects carry outcome CODES only. 'use server' exports ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { BrandDraftInput, BrandReview, BrandSaved } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import {
  BRANDING_HREF, BRAND_PUBLISH_HREF, brandProposalHref, contrastFailuresFrom, failureCodesFrom, isIdemKey, isUuid,
} from '../../../features/branding/branding';

export type BrandPreviewResult = { ok: true; review: BrandReview } | { ok: false; codes: string[] };
export type BrandSaveResult = { ok: true; saved: BrandSaved } | { ok: false; codes: string[] };

const HEX = /^#?[0-9a-fA-F]{6}$/;
const clean = (i: BrandDraftInput): BrandDraftInput => {
  const out: BrandDraftInput = {};
  if (typeof i?.displayName === 'string') out.displayName = i.displayName.slice(0, 200);
  if (typeof i?.appShortName === 'string') out.appShortName = i.appShortName.slice(0, 60);
  for (const k of ['primaryColor', 'accentColor', 'inkColor', 'surfaceColor'] as const) {
    const v = i?.[k];
    if (typeof v === 'string') out[k] = HEX.test(v.trim()) ? (v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`) : v.slice(0, 7);
  }
  if (typeof i?.poweredByHidden === 'boolean') out.poweredByHidden = i.poweredByHidden;
  if (typeof i?.reason === 'string' && i.reason.trim()) out.reason = i.reason.trim().slice(0, 500);
  return out;
};
const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown']; };
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** W2794 — the review (writes nothing). */
export async function previewBrandAction(input: BrandDraftInput): Promise<BrandPreviewResult> {
  await requireSession(BRANDING_HREF);
  try { return { ok: true, review: await tenantClient().branding.preview(clean(input)) }; }
  catch (e) { return { ok: false, codes: codesOf(e) }; }
}

/** W2795 — save the draft (keyed). */
export async function saveBrandDraftAction(input: BrandDraftInput, idempotencyKey: string): Promise<BrandSaveResult> {
  await requireSession(BRANDING_HREF);
  const key = isIdemKey(idempotencyKey) ? idempotencyKey : randomUUID();
  try {
    const saved = await tenantClient().branding.saveDraft(clean(input), key);
    revalidatePath(BRANDING_HREF);
    return { ok: true, saved };
  } catch (e) { return { ok: false, codes: codesOf(e) }; }
}

/** The logo upload: the FILE, raw, with its own type (the API decides what it really is). */
export async function uploadLogoAction(formData: FormData): Promise<void> {
  await requireSession(BRANDING_HREF);
  const file = formData.get('logo');
  const idem = String(formData.get('idempotencyKey') ?? '');
  if (!(file instanceof File) || file.size === 0) redirect(`${BRANDING_HREF}?${qs({ logoError: 'LOGO_EMPTY' })}#logo`);
  const f = file as File;
  const type = f.type === 'image/svg+xml' ? 'image/svg+xml' : f.type === 'image/png' ? 'image/png' : '';
  if (!type) redirect(`${BRANDING_HREF}?${qs({ logoError: 'LOGO_TYPE_UNSUPPORTED' })}#logo`);
  if (f.size > 512 * 1024) redirect(`${BRANDING_HREF}?${qs({ logoError: 'LOGO_TOO_LARGE' })}#logo`);
  let failed: string[] | null = null; let stripped = '';
  try {
    const r = await tenantClient().branding.uploadLogo(new Uint8Array(await f.arrayBuffer()), type as 'image/png' | 'image/svg+xml', isIdemKey(idem) ? idem : randomUUID());
    stripped = r.stripped.filter((s) => /^[a-z_:*-]{1,40}$/.test(s)).slice(0, 6).join(',');
  } catch (e) {
    failed = codesOf(e);
    const found = ((e instanceof SdkError ? (e.details as { found?: unknown[] } | undefined)?.found : undefined) ?? []).filter((x): x is string => typeof x === 'string' && /^[a-z_:-]{1,40}$/.test(x)).slice(0, 8);
    if (found.length) redirect(`${BRANDING_HREF}?${qs({ logoError: failed.join(','), found: found.join(',') })}#logo`);
  }
  revalidatePath(BRANDING_HREF);
  if (failed) redirect(`${BRANDING_HREF}?${qs({ logoError: failed.join(',') })}#logo`);
  redirect(`${BRANDING_HREF}?${qs({ logoOk: '1', ...(stripped ? { stripped } : {}) })}#logo`);
}

/** W2797 → W2798 / W2799 — propose a publish or a rollback. */
export async function proposePublishAction(formData: FormData): Promise<void> {
  await requireSession(BRAND_PUBLISH_HREF);
  const kind = String(formData.get('kind') ?? '') === 'rollback' ? 'rollback' : 'publish';
  const version = Number(formData.get('version') ?? 0);
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const idem = String(formData.get('idempotencyKey') ?? '');
  const key = isIdemKey(idem) ? idem : randomUUID();
  const back = { kind, ...(kind === 'rollback' ? { version: String(version) } : {}), reason };
  let failed: string[] | null = null; let contrast = ''; let id = '';
  try {
    const c = tenantClient();
    id = (kind === 'rollback' ? await c.branding.rollback(version, reason, key) : await c.branding.propose(reason, key)).id;
  } catch (e) {
    failed = codesOf(e);
    contrast = contrastFailuresFrom(e instanceof SdkError ? e.details : null).map((f) => `${f.pair}:${f.display}`).join(',');
  }
  revalidatePath(BRANDING_HREF);
  if (failed) redirect(`${BRAND_PUBLISH_HREF}?${qs({ ...back, step: 'failure', error: failed.join(','), ...(contrast ? { contrast } : {}) })}`);
  redirect(`${BRAND_PUBLISH_HREF}?${qs({ kind, step: 'success', proposal: id })}`);
}

/** W2798 — confirm (publishes) / refuse, by a different administrator for a confirm. */
export async function proposalActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '') === 'refuse' ? 'refuse' : 'confirm';
  await requireSession(BRANDING_HREF);
  if (!isUuid(id)) redirect(BRANDING_HREF);
  const idem = String(formData.get('idempotencyKey') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const key = isIdemKey(idem) ? idem : randomUUID();
  let failed: string[] | null = null; let version = ''; let entity = '';
  try {
    if (act === 'confirm') { const r = await tenantClient().branding.confirm(id, key); version = String(r.version); entity = r.audit.entityId; }
    else await tenantClient().branding.refuse(id, reason, key);
  } catch (e) { failed = codesOf(e); }
  revalidatePath(BRANDING_HREF);
  if (failed) redirect(`${brandProposalHref(id, 'failure')}&${qs({ act, error: failed.join(',') })}`);
  redirect(`${brandProposalHref(id, 'success')}&${qs({ act, ...(version ? { version } : {}), ...(isUuid(entity) ? { entity } : {}) })}`);
}
