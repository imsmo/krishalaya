'use server';
// apps/web-admin/src/app/moderation/actions.ts — extended for ADMIN-5f. See the ADMIN-5d header below.
//
// ADMIN-5f ADDS THE FOUR ACTS THAT TOUCH A FARMER'S LISTING. None sends a value at stake: the figure that decides
// whether a removal needs a second operator is computed server-side from the listing row, and a client that could
// supply it could supply ₹99,999.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../lib/admin-client';
import { buildAddBlock, buildPropose, buildBandChange } from '../../features/trust/trust-safety';
import { buildOrder, buildDecide } from '../../features/moderation/queue';
import { buildDecide as buildAppealDecide } from '../../features/moderation/appeals';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'conflict';
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
const enc = encodeURIComponent;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/* ==================== ADMIN-5d · blocklists, risk rules, bands ==================== */

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
        ...(built.value.expiresAt ? { expiresAt: new Date(built.value.expiresAt).toISOString() } : {}),
        ...(built.value.reviewAt ? { reviewAt: new Date(built.value.reviewAt).toISOString() } : {}),
      },
    });
    already = r.data?.alreadyBlocked === true;
  } catch (e) { redirect(`/moderation/blocklists?error=${errorKey(e)}`); }
  revalidatePath('/moderation/blocklists');
  revalidatePath('/moderation');
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

/* ==================== ADMIN-5f · the queue ==================== */

export async function holdAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  if (!id) redirect('/moderation/listings');
  const built = buildOrder({
    source: s(formData, 'source'), sourceRef: s(formData, 'sourceRef'),
    reason: s(formData, 'reason'), languageCode: s(formData, 'languageCode'),
  }, true);
  if (!built.ok) redirect(`/moderation/listings/${enc(id)}?error=${built.error}`);
  try { await adminPost(`moderation/listings/${enc(id)}/hold`, { body: built.value }); }
  catch (e) { redirect(`/moderation/listings/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/moderation/listings/${id}`);
  revalidatePath('/moderation/listings');
  redirect(`/moderation/listings/${enc(id)}?ok=held`);
}

export async function releaseAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  if (!id) redirect('/moderation/listings');
  const built = buildOrder({
    reason: s(formData, 'reason'), languageCode: s(formData, 'languageCode'),
    reporterUserId: s(formData, 'reporterUserId'),
  }, false);
  if (!built.ok) redirect(`/moderation/listings/${enc(id)}?error=${built.error}`);
  try { await adminPost(`moderation/listings/${enc(id)}/release`, { body: built.value }); }
  catch (e) { redirect(`/moderation/listings/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/moderation/listings/${id}`);
  revalidatePath('/moderation/listings');
  redirect(`/moderation/listings/${enc(id)}?ok=released`);
}

export async function removeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  if (!id) redirect('/moderation/listings');
  const built = buildOrder({
    reason: s(formData, 'reason'), languageCode: s(formData, 'languageCode'),
    reporterUserId: s(formData, 'reporterUserId'), checkerNote: s(formData, 'checkerNote'),
  }, false);
  if (!built.ok) redirect(`/moderation/listings/${enc(id)}?error=${built.error}`);
  try { await adminPost(`moderation/listings/${enc(id)}/remove`, { body: built.value }); }
  catch (e) { redirect(`/moderation/listings/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/moderation/listings/${id}`);
  revalidatePath('/moderation/listings');
  redirect(`/moderation/listings/${enc(id)}?ok=removed`);
}

export async function decideReportAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  if (!id) redirect('/moderation/reports');
  const built = buildDecide({
    status: s(formData, 'status'), outcome: s(formData, 'outcome'),
    outcomeNote: s(formData, 'outcomeNote'), languageCode: s(formData, 'languageCode'),
  });
  if (!built.ok) redirect(`/moderation/reports?error=${built.error}`);
  try { await adminPost(`moderation/reports/${enc(id)}/decide`, { body: built.value }); }
  catch (e) { redirect(`/moderation/reports?error=${errorKey(e)}`); }
  revalidatePath('/moderation/reports');
  revalidatePath('/moderation');
  redirect(`/moderation/reports?ok=${built.value.status}`);
}

/* ==================== ADMIN-SWEEP-b1 · appeals (W097 + W1953–W1955) ==================== */

/** "Take next" — deliberately carries NOTHING but the click. Which appeal the operator gets is the queue's decision
 *  (oldest deadline they are allowed to judge, ≠-reviewer applied server-side); a claim that could name its appeal
 *  would let a reviewer cherry-pick. Success lands ON the claimed case; an empty queue explains WHICH empty it is. */
export async function takeNextAppealAction(): Promise<void> {
  requireAdmin();
  let r: { claimed: boolean; appeal?: { id: string }; empty?: { kind: string } };
  try { r = (await adminPost<{ claimed: boolean; appeal?: { id: string }; empty?: { kind: string } }>('moderation/appeals/take-next', { body: {} })).data; }
  catch (e) { redirect(`/moderation/appeals?error=${errorKey(e)}`); }
  revalidatePath('/moderation/appeals');
  if (r.claimed && r.appeal) redirect(`/moderation/appeals/${enc(r.appeal.id)}?ok=claimed`);
  redirect(`/moderation/appeals?empty=${r.empty?.kind === 'only_your_own' ? 'onlyYourOwn' : 'queueClear'}`);
}

/** Decide (uphold / overturn). The W1953 confirm step is the form itself — it states the four consequences with
 *  their real provider states before this action fires; W1954/W1955 are the ok/error states it lands on. */
export async function decideAppealAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  if (!id) redirect('/moderation/appeals');
  const built = buildAppealDecide({
    outcome: s(formData, 'outcome'), reason: s(formData, 'reason'), languageCode: s(formData, 'languageCode'),
  });
  if (!built.ok) redirect(`/moderation/appeals/${enc(id)}?error=${built.error}`);
  try { await adminPost(`moderation/appeals/${enc(id)}/decide`, { body: built.value }); }
  catch (e) { redirect(`/moderation/appeals/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/moderation/appeals/${id}`);
  revalidatePath('/moderation/appeals');
  revalidatePath('/moderation');
  redirect(`/moderation/appeals/${enc(id)}?ok=${built.value.outcome}`);
}
