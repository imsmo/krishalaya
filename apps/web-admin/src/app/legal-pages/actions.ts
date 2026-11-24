'use server';
// apps/web-admin/src/app/legal-pages/actions.ts · PC-56 LEGAL-1 — platform policy pages (/terms, /privacy, /refunds,
// /shipping on the storefront).
//
// admin-api re-authorises every one of these: `platform.pages.manage` to draft / edit / archive a draft,
// `platform.pages.publish` (+ hardware key + step-up) to publish or archive the live version, a reason of 20..2000
// characters, and — on publish — a DIFFERENT operator from the one who authored or last edited the draft (DB trigger +
// service). Every write sends a fresh `Idempotency-Key` (crypto.randomUUID per submission, the same convention as the
// billing adjustment action); writes are never auto-retried by the client.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPatch, adminPost, AdminApiError } from '../../lib/admin-client';
import {
  buildArchive, buildCreateDraft, buildPublish, buildSaveDraft, encodeProblems, errorKindFor, isPlatformPageSlug,
  problemsFrom,
} from '../../features/legal-pages/legal-pages';

const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/** The URL a refusal lands on: the typed kind, plus every body problem when admin-api returned them. */
function refusalUrl(back: string, e: unknown): string {
  if (e instanceof AdminApiError) {
    const kind = errorKindFor(e.code, e.status, e.message);
    const problems = problemsFrom(e.details);
    return `${back}?error=${kind}${problems.length ? `&problems=${encodeProblems(problems)}` : ''}`;
  }
  return `${back}?error=generic`;
}

function backFor(fd: FormData): string {
  const slug = str(fd, 'slug');
  if (!isPlatformPageSlug(slug)) redirect('/legal-pages?error=unknownSlug');
  return `/legal-pages/${slug}`;
}

function done(back: string, ok: string): never {
  revalidatePath(back); revalidatePath('/legal-pages');
  redirect(`${back}?ok=${ok}`);
}

/** Open the next version as a draft (prefilled from the live words by the page). Nothing on the storefront changes. */
export async function createDraftAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back = backFor(formData);
  const slug = str(formData, 'slug');
  const built = buildCreateDraft(formData);
  if (!built.ok) redirect(`${back}?error=${built.error}`);
  try {
    await adminPost(`platform-pages/${enc(slug)}/drafts`, { body: built.value, idempotencyKey: randomUUID() });
  } catch (e) { redirect(refusalUrl(back, e)); }
  done(back, 'drafted');
}

/** Save the open draft. Saving — even unchanged — names the caller as the draft's last editor ("adopting" a seeded
 *  draft), which is what lets a DIFFERENT operator publish it. */
export async function saveDraftAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back = backFor(formData);
  const versionId = str(formData, 'versionId');
  if (!versionId) redirect(back);
  const built = buildSaveDraft(formData);
  if (!built.ok) redirect(`${back}?error=${built.error}`);
  try {
    await adminPatch(`platform-pages/versions/${enc(versionId)}`, { body: built.value, idempotencyKey: randomUUID() });
  } catch (e) { redirect(refusalUrl(back, e)); }
  done(back, 'saved');
}

/** **THE ONLY ACTION HERE THE PUBLIC CAN SEE.** Elevated (hardware key + step-up), maker ≠ checker, and it archives the
 *  previously live version as `superseded`. */
export async function publishAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back = backFor(formData);
  const versionId = str(formData, 'versionId');
  if (!versionId) redirect(back);
  const built = buildPublish(formData);
  if (!built.ok) redirect(`${back}?error=${built.error}`);
  try {
    await adminPost(`platform-pages/versions/${enc(versionId)}/publish`, { body: built.value, idempotencyKey: randomUUID() });
  } catch (e) { redirect(refusalUrl(back, e)); }
  done(back, 'published');
}

/** Archive a draft (manage) or the live version (publish — the storefront then shows "not published yet"). */
export async function archiveAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back = backFor(formData);
  const versionId = str(formData, 'versionId');
  if (!versionId) redirect(back);
  const built = buildArchive(formData);
  if (!built.ok) redirect(`${back}?error=${built.error}`);
  try {
    await adminPost(`platform-pages/versions/${enc(versionId)}/archive`, { body: built.value, idempotencyKey: randomUUID() });
  } catch (e) { redirect(refusalUrl(back, e)); }
  done(back, 'archived');
}
