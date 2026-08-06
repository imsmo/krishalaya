'use server';
// apps/web-admin/src/app/schemes-registry/actions.ts · god-mode government-scheme MASTER mutations — the ONLY
// place the admin bearer writes for the schemes-registry path. A master edit ripples into every tenant's scheme
// catalogue + applications, so admin-api re-authorises SERVER-SIDE (schemes.registry.manage + FIDO2 hardware-key +
// step-up) and audits every change; the operator's mandatory reason goes in the body. processing_fee_minor is a
// minor-unit digit STRING (Law 2, never floated). No Idempotency-Key (admin-api exposes none); no auto-retry.
// 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, AdminApiError } from '../../lib/admin-client';
import { buildCreateAuthority, buildUpdateAuthority, buildCreateScheme, buildUpdateMeta, buildUpdateRules, buildSetWindow, buildSetActive } from '../../features/schemes-registry/scheme';
import { buildSaveDraft, buildMapPortal } from '../../features/schemes-registry/version';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'conflict';     // code exists / already in state
    if (e.status === 422) return 'invalid';        // input / category invalid
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

/* ---- authorities ---- */
export async function createAuthorityAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildCreateAuthority({ defaultName: str(formData, 'defaultName'), level: str(formData, 'level'), regionId: str(formData, 'regionId'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/schemes-registry?error=${built.error}`);
  let id: string | undefined;
  try { id = (await adminPost<{ id: string }>('schemes-registry/authorities', { body: built.value })).data?.id; }
  catch (e) { redirect(`/schemes-registry?error=${errorKey(e)}`); }
  revalidatePath('/schemes-registry');
  redirect(id ? `/schemes-registry/authorities/${enc(id)}?ok=created` : '/schemes-registry?ok=created');
}

export async function updateAuthorityAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/schemes-registry');
  const built = buildUpdateAuthority({ defaultName: str(formData, 'defaultName'), level: str(formData, 'level'), regionId: str(formData, 'regionId'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/schemes-registry/authorities/${enc(id)}?error=${built.error}`);
  try { await adminPatch(`schemes-registry/authorities/${enc(id)}`, { body: built.value }); }
  catch (e) { redirect(`/schemes-registry/authorities/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/schemes-registry/authorities/${id}`);
  redirect(`/schemes-registry/authorities/${enc(id)}?ok=updated`);
}

/* ---- schemes ---- */
export async function createSchemeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildCreateScheme({
    code: str(formData, 'code'), defaultName: str(formData, 'defaultName'), authorityId: str(formData, 'authorityId'), categoryId: str(formData, 'categoryId'),
    benefitSummary: str(formData, 'benefitSummary'), eligibilityRules: str(formData, 'eligibilityRules'),
    requiredDocTypeIds: str(formData, 'requiredDocTypeIds'), applicableRegionIds: str(formData, 'applicableRegionIds'),
    applicationWindow_opens: str(formData, 'opens'), applicationWindow_closes: str(formData, 'closes'), applicationWindow_season: str(formData, 'season'),
    processingFeeMinor: str(formData, 'processingFeeMinor'), sourceUrl: str(formData, 'sourceUrl'), reason: str(formData, 'reason'),
  });
  if (!built.ok) redirect(`/schemes-registry/schemes?error=${built.error}`);
  let id: string | undefined;
  try { id = (await adminPost<{ id: string }>('schemes-registry/schemes', { body: built.value })).data?.id; }
  catch (e) { redirect(`/schemes-registry/schemes?error=${errorKey(e)}`); }
  revalidatePath('/schemes-registry/schemes');
  redirect(id ? `/schemes-registry/schemes/${enc(id)}?ok=created` : '/schemes-registry/schemes?ok=created');
}

export async function updateMetaAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/schemes-registry/schemes');
  const built = buildUpdateMeta({ defaultName: str(formData, 'defaultName'), authorityId: str(formData, 'authorityId'), categoryId: str(formData, 'categoryId'), sourceUrl: str(formData, 'sourceUrl'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/schemes-registry/schemes/${enc(id)}?error=${built.error}`);
  try { await adminPatch(`schemes-registry/schemes/${enc(id)}`, { body: built.value }); }
  catch (e) { redirect(`/schemes-registry/schemes/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/schemes-registry/schemes/${id}`);
  redirect(`/schemes-registry/schemes/${enc(id)}?ok=meta`);
}

export async function updateRulesAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/schemes-registry/schemes');
  const built = buildUpdateRules({ benefitSummary: str(formData, 'benefitSummary'), eligibilityRules: str(formData, 'eligibilityRules'), requiredDocTypeIds: str(formData, 'requiredDocTypeIds'), applicableRegionIds: str(formData, 'applicableRegionIds'), processingFeeMinor: str(formData, 'processingFeeMinor'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/schemes-registry/schemes/${enc(id)}?error=${built.error}`);
  try { await adminPost(`schemes-registry/schemes/${enc(id)}/rules`, { body: built.value }); }
  catch (e) { redirect(`/schemes-registry/schemes/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/schemes-registry/schemes/${id}`);
  redirect(`/schemes-registry/schemes/${enc(id)}?ok=rules`);
}

export async function setWindowAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/schemes-registry/schemes');
  const built = buildSetWindow({ opens: str(formData, 'opens'), closes: str(formData, 'closes'), season: str(formData, 'season'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/schemes-registry/schemes/${enc(id)}?error=${built.error}`);
  try { await adminPost(`schemes-registry/schemes/${enc(id)}/window`, { body: built.value }); }
  catch (e) { redirect(`/schemes-registry/schemes/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/schemes-registry/schemes/${id}`);
  redirect(`/schemes-registry/schemes/${enc(id)}?ok=window`);
}

export async function setSchemeActiveAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/schemes-registry/schemes');
  const built = buildSetActive({ isActive: str(formData, 'isActive'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/schemes-registry/schemes/${enc(id)}?error=${built.error}`);
  try { await adminPost(`schemes-registry/schemes/${enc(id)}/active`, { body: built.value }); }
  catch (e) { redirect(`/schemes-registry/schemes/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/schemes-registry/schemes/${id}`);
  redirect(`/schemes-registry/schemes/${enc(id)}?ok=${built.value.isActive ? 'activated' : 'deactivated'}`);
}

/* ========================= the version plane (PC-56 ADMIN-4 / migration 0105) =========================
   A rules or window edit no longer touches the live scheme row: it opens or updates a DRAFT, and a DIFFERENT
   operator publishes it. The maker-checker refusal comes back as a 409 and is surfaced with its own error key
   (`selfPublish`), because "conflict" would be read as somebody else having got there first — the opposite of
   what happened.                                                                                              */

function versionErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    const code = e.code;
    if (code === 'SCHEME_VERSION_SELF_PUBLISH') return 'selfPublish';
    if (code === 'SCHEME_VERSION_NOT_DRAFT') return 'notDraft';
    if (code === 'SCHEME_DRAFT_OPEN') return 'draftOpen';
    if (code === 'SCHEME_NO_PUBLISHED_VERSION') return 'noPublished';
    if (code === 'SCHEME_PORTAL_MAPPING_CONFLICT') return 'portalHeld';
  }
  return errorKey(e);
}

export async function saveDraftAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/schemes-registry/schemes');
  const built = buildSaveDraft({
    benefitSummary: str(formData, 'benefitSummary'), eligibilityRules: str(formData, 'eligibilityRules'),
    requiredDocTypeIds: str(formData, 'requiredDocTypeIds'), applicableRegionIds: str(formData, 'applicableRegionIds'),
    window_opens: str(formData, 'window_opens'), window_closes: str(formData, 'window_closes'),
    window_season: str(formData, 'window_season'), window_clear: str(formData, 'window_clear'),
    processingFeeMinor: str(formData, 'processingFeeMinor'), reason: str(formData, 'reason'),
  });
  if (!built.ok) redirect(`/schemes-registry/schemes/${enc(id)}/versions?error=${built.error}`);
  let versionId: string | undefined;
  try { versionId = (await adminPost<{ versionId: string }>(`schemes-registry/schemes/${enc(id)}/versions`, { body: built.value })).data?.versionId; }
  catch (e) { redirect(`/schemes-registry/schemes/${enc(id)}/versions?error=${versionErrorKey(e)}`); }
  revalidatePath(`/schemes-registry/schemes/${id}/versions`);
  // Straight to the REVIEW page, not back to the form. The next thing that should happen to a draft is somebody
  // reading it, and landing on the diff is what makes the review step a step rather than a page nobody opens.
  redirect(versionId ? `/schemes-registry/schemes/${enc(id)}/versions/${enc(versionId)}?ok=drafted` : `/schemes-registry/schemes/${enc(id)}/versions?ok=drafted`);
}

export async function publishVersionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  const versionId = str(formData, 'versionId').trim();
  if (!id || !versionId) redirect('/schemes-registry/schemes');
  const note = str(formData, 'checkerNote').trim();
  if (note.length > 1000) redirect(`/schemes-registry/schemes/${enc(id)}/versions/${enc(versionId)}?error=checkerNote`);
  const body: Record<string, unknown> = { versionId };
  if (note) body.checkerNote = note;      // absent, not empty-string: the schema requires min(1) when present
  try { await adminPost(`schemes-registry/schemes/${enc(id)}/versions/publish`, { body }); }
  catch (e) { redirect(`/schemes-registry/schemes/${enc(id)}/versions/${enc(versionId)}?error=${versionErrorKey(e)}`); }
  revalidatePath(`/schemes-registry/schemes/${id}`);
  revalidatePath(`/schemes-registry/schemes/${id}/versions`);
  redirect(`/schemes-registry/schemes/${enc(id)}/versions?ok=published`);
}

export async function discardDraftAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  const versionId = str(formData, 'versionId').trim();
  if (!id || !versionId) redirect('/schemes-registry/schemes');
  const reason = str(formData, 'reason').trim();
  if (reason.length < 3 || reason.length > 1000) redirect(`/schemes-registry/schemes/${enc(id)}/versions/${enc(versionId)}?error=reason`);
  try { await adminPost(`schemes-registry/schemes/${enc(id)}/versions/discard`, { body: { versionId, reason } }); }
  catch (e) { redirect(`/schemes-registry/schemes/${enc(id)}/versions/${enc(versionId)}?error=${versionErrorKey(e)}`); }
  revalidatePath(`/schemes-registry/schemes/${id}/versions`);
  redirect(`/schemes-registry/schemes/${enc(id)}/versions?ok=discarded`);
}

/* ---- DELTA-018: which government portal an authority files through ---- */
export async function mapPortalAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/schemes-registry');
  const built = buildMapPortal({ providerCode: str(formData, 'providerCode'), externalId: str(formData, 'externalId'), endpointLabel: str(formData, 'endpointLabel'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/schemes-registry/authorities/${enc(id)}?error=${built.error}`);
  try { await adminPost(`schemes-registry/authorities/${enc(id)}/portal`, { body: built.value }); }
  catch (e) { redirect(`/schemes-registry/authorities/${enc(id)}?error=${versionErrorKey(e)}`); }
  revalidatePath(`/schemes-registry/authorities/${id}`);
  redirect(`/schemes-registry/authorities/${enc(id)}?ok=portalMapped`);
}

export async function unmapPortalAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  const providerCode = str(formData, 'providerCode').trim();
  if (!id) redirect('/schemes-registry');
  const reason = str(formData, 'reason').trim();
  if (reason.length < 3 || reason.length > 1000) redirect(`/schemes-registry/authorities/${enc(id)}?error=reason`);
  try { await adminPost(`schemes-registry/authorities/${enc(id)}/portal/unmap`, { body: { providerCode, reason } }); }
  catch (e) { redirect(`/schemes-registry/authorities/${enc(id)}?error=${versionErrorKey(e)}`); }
  revalidatePath(`/schemes-registry/authorities/${id}`);
  redirect(`/schemes-registry/authorities/${enc(id)}?ok=portalUnmapped`);
}
