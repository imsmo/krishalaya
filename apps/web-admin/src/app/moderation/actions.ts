'use server';
// apps/web-admin/src/app/moderation/actions.ts · god-mode trust & safety mutations (PC-56 ADMIN-5d).
//
// The ONLY place the admin bearer writes on this path. Every one is re-authorised SERVER-SIDE by admin-api
// (`risk.act` or `risk.rules` + step-up) and records an audit row, so the operator's mandatory justification goes in
// the body rather than being inferred.
//
// TWO THINGS THIS FILE DELIBERATELY DOES NOT DO:
//   • It never sends a HASH. `addBlockAction` posts the RAW identifier and admin-api hashes it — the console has no
//     business computing the value the uniqueness index depends on, and a second implementation of the normalisation
//     rule is a second chance for it to disagree.
//   • It passes no Idempotency-Key, because admin-api exposes none on this path. Mutations therefore never auto-retry,
//     which on "add a platform block" is the right default: a duplicate is caught by the partial unique index and
//     reported as already-blocked rather than silently creating a second expiry date.
//
// 'use server' files export ONLY async functions — every validator lives in features/trust/trust-safety.ts.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../lib/admin-client';
import { buildAddBlock, buildPropose, buildBandChange } from '../../features/trust/trust-safety';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    // 409 is the two-person rule and the dry-run gate — a STATE conflict, not an authorisation failure. The
    // distinction shows up in the operator's next move: find a colleague, or re-run the dry run.
    if (e.status === 409) return 'conflict';
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
const enc = encodeURIComponent;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/* ---------------- blocklists (W096) ---------------- */

export async function addBlockAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildAddBlock({
    identifierType: s(formData, 'identifierType'), identifier: s(formData, 'identifier'),
    originRef: s(formData, 'originRef'), reason: s(formData, 'reason'),
    expiresAt: s(formData, 'expiresAt'), reviewAt: s(formData, 'reviewAt'), auditNote: s(formData, 'auditNote'),
  });
  if (!built.ok) redirect(`/moderation/blocklists?error=${built.error}`);
  let already = false;
  try {
    const r = await adminPost<{ alreadyBlocked: boolean }>('trust/blocklists', {
      body: {
        ...built.value,
        // A `datetime-local` value has no zone. Sent as an ISO instant so the platform and the operator agree on when
        // a block lapses — an expiry read an hour early or late is a person let back in, or kept out, by a timezone.
        ...(built.value.expiresAt ? { expiresAt: new Date(built.value.expiresAt).toISOString() } : {}),
        ...(built.value.reviewAt ? { reviewAt: new Date(built.value.reviewAt).toISOString() } : {}),
      },
    });
    already = r.data?.alreadyBlocked === true;
  } catch (e) { redirect(`/moderation/blocklists?error=${errorKey(e)}`); }
  revalidatePath('/moderation/blocklists');
  revalidatePath('/moderation');
  // Reported distinctly. An operator who believes their expiry date is in force when somebody else's is would stop
  // watching an identifier that lapses next week.
  redirect(`/moderation/blocklists?ok=${already ? 'alreadyBlocked' : 'added'}`);
}

export async function countersignBlockAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  if (!id) redirect('/moderation/blocklists');
  const note = s(formData, 'note');
  if (!note) redirect('/moderation/blocklists?error=auditNote');
  try { await adminPost(`trust/blocklists/${enc(id)}/countersign`, { body: { note } }); }
  catch (e) { redirect(`/moderation/blocklists?error=${errorKey(e)}`); }
  revalidatePath('/moderation/blocklists');
  revalidatePath('/moderation');
  redirect('/moderation/blocklists?ok=countersigned');
}

export async function liftBlockAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  if (!id) redirect('/moderation/blocklists');
  const reason = s(formData, 'reason');
  if (reason.length < 12) redirect('/moderation/blocklists?error=reason');
  try { await adminPost(`trust/blocklists/${enc(id)}/lift`, { body: { reason } }); }
  catch (e) { redirect(`/moderation/blocklists?error=${errorKey(e)}`); }
  revalidatePath('/moderation/blocklists');
  revalidatePath('/moderation');
  redirect('/moderation/blocklists?ok=lifted');
}

/* ---------------- risk rules (W095) ---------------- */

export async function proposeWeightAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = s(formData, 'code');
  if (!code) redirect('/moderation/risk/rules');
  const built = buildPropose({
    proposedWeight: s(formData, 'proposedWeight'), changeReason: s(formData, 'changeReason'),
    bandDrops: s(formData, 'bandDrops'), newRestricted: s(formData, 'newRestricted'),
    population: s(formData, 'population'), computedAt: s(formData, 'computedAt'),
  });
  if (!built.ok) redirect(`/moderation/risk/rules?error=${built.error}`);
  try {
    await adminPost(`trust/risk/rules/${enc(code)}/propose`, {
      body: { ...built.value, dryRun: { ...built.value.dryRun, computedAt: new Date(built.value.dryRun.computedAt).toISOString() } },
    });
  } catch (e) { redirect(`/moderation/risk/rules?error=${errorKey(e)}`); }
  revalidatePath('/moderation/risk/rules');
  redirect('/moderation/risk/rules?ok=proposed');
}

export async function approveWeightAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = s(formData, 'code');
  const note = s(formData, 'note');
  if (!code) redirect('/moderation/risk/rules');
  if (!note) redirect('/moderation/risk/rules?error=reason');
  try { await adminPost(`trust/risk/rules/${enc(code)}/approve`, { body: { note } }); }
  catch (e) { redirect(`/moderation/risk/rules?error=${errorKey(e)}`); }
  revalidatePath('/moderation/risk/rules');
  revalidatePath('/moderation');
  redirect('/moderation/risk/rules?ok=approved');
}

export async function withdrawProposalAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = s(formData, 'code');
  const reason = s(formData, 'reason');
  if (!code) redirect('/moderation/risk/rules');
  if (!reason) redirect('/moderation/risk/rules?error=reason');
  try { await adminPost(`trust/risk/rules/${enc(code)}/withdraw`, { body: { reason } }); }
  catch (e) { redirect(`/moderation/risk/rules?error=${errorKey(e)}`); }
  revalidatePath('/moderation/risk/rules');
  redirect('/moderation/risk/rules?ok=withdrawn');
}

/* ---------------- risk profile (W094) ---------------- */

export async function changeBandAction(formData: FormData): Promise<void> {
  requireAdmin();
  const userId = s(formData, 'userId');
  if (!userId) redirect('/moderation/risk');
  const built = buildBandChange({
    band: s(formData, 'band'), reason: s(formData, 'reason'),
    currentBand: s(formData, 'currentBand') || null,
  });
  if (!built.ok) redirect(`/moderation/risk/accounts/${enc(userId)}?error=${built.error}`);
  try { await adminPost(`trust/risk/accounts/${enc(userId)}/band`, { body: built.value }); }
  catch (e) { redirect(`/moderation/risk/accounts/${enc(userId)}?error=${errorKey(e)}`); }
  revalidatePath(`/moderation/risk/accounts/${userId}`);
  revalidatePath('/moderation/risk');
  redirect(`/moderation/risk/accounts/${enc(userId)}?ok=bandChanged`);
}
