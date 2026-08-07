'use server';
// apps/web-admin/src/app/compliance/actions.ts · god-mode DPDP/compliance mutations — the ONLY place the admin
// bearer writes for the compliance path. Each is re-authorised SERVER-SIDE by admin-api (compliance.manage +
// FIDO2 hardware-key + step-up) and records an audit row, so the operator's mandatory justification (resolution /
// reason / note) goes in the body. PII-MINIMAL: nothing here accepts raw subject data — breaches carry data
// CATEGORIES only. admin-api exposes no Idempotency-Key here, so none is passed; mutations never auto-retry.
// 'use server' files export ONLY async functions — validation lives in features/compliance/compliance.ts.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, AdminApiError } from '../../lib/admin-client';
import { buildDsrUpdate, buildExportDecision, buildRetention, buildOpenBreach, buildBreachUpdate } from '../../features/compliance/compliance';
import { buildReject, buildRecordAction } from '../../features/compliance/erasure';
import { buildSaveNotice, buildOpenDraft } from '../../features/compliance/consent';
import { buildRecordStep } from '../../features/compliance/breach-notification';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'conflict';     // illegal transition / cooling-active / export-already-decided
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
const enc = encodeURIComponent;

export async function updateDsrAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/compliance');
  const built = buildDsrUpdate({ action: String(formData.get('action') ?? ''), resolution: String(formData.get('resolution') ?? ''), exportMediaId: String(formData.get('exportMediaId') ?? '') });
  if (!built.ok) redirect(`/compliance/dsr/${enc(id)}?error=${built.error}`);
  try { await adminPatch(`compliance/dsr/${enc(id)}`, { body: built.value }); }
  catch (e) { redirect(`/compliance/dsr/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/compliance/dsr/${id}`);
  revalidatePath('/compliance');
  redirect(`/compliance/dsr/${enc(id)}?ok=${built.value.action}`);
}

export async function decideExportAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/compliance/exports');
  const built = buildExportDecision({ decision: String(formData.get('decision') ?? ''), reason: String(formData.get('reason') ?? '') });
  if (!built.ok) redirect(`/compliance/exports?error=${built.error}`);
  try { await adminPost(`compliance/exports/${enc(id)}/decision`, { body: built.value }); }
  catch (e) { redirect(`/compliance/exports?error=${errorKey(e)}`); }
  revalidatePath('/compliance/exports');
  redirect(`/compliance/exports?ok=${built.value.decision}`);
}

export async function upsertRetentionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildRetention({
    tableName: String(formData.get('tableName') ?? ''), activeMonths: String(formData.get('activeMonths') ?? ''),
    archiveMonths: String(formData.get('archiveMonths') ?? ''), legalBasis: String(formData.get('legalBasis') ?? ''),
    action: String(formData.get('action') ?? ''), isActive: String(formData.get('isActive') ?? 'true'),
    reason: String(formData.get('reason') ?? ''),
  });
  if (!built.ok) redirect(`/compliance/retention?error=${built.error}`);
  try { await adminPost('compliance/retention', { body: built.value }); }
  catch (e) { redirect(`/compliance/retention?error=${errorKey(e)}`); }
  revalidatePath('/compliance/retention');
  redirect('/compliance/retention?ok=saved');
}

export async function openBreachAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildOpenBreach({
    affectedTenantId: String(formData.get('affectedTenantId') ?? ''), severity: String(formData.get('severity') ?? 'high'),
    title: String(formData.get('title') ?? ''), description: String(formData.get('description') ?? ''),
    affectedData: String(formData.get('affectedData') ?? ''), affectedCount: String(formData.get('affectedCount') ?? ''),
    detectedAt: String(formData.get('detectedAt') ?? ''),
  });
  if (!built.ok) redirect(`/compliance/breaches?error=${built.error}`);
  let id: string | undefined;
  try { id = (await adminPost<{ id: string }>('compliance/breaches', { body: built.value })).data?.id; }
  catch (e) { redirect(`/compliance/breaches?error=${errorKey(e)}`); }
  revalidatePath('/compliance/breaches');
  redirect(id ? `/compliance/breaches/${enc(id)}?ok=opened` : '/compliance/breaches?ok=opened');
}

export async function updateBreachAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/compliance/breaches');
  const built = buildBreachUpdate({
    action: String(formData.get('action') ?? ''), note: String(formData.get('note') ?? ''),
    regulatorNotifiedAt: String(formData.get('regulatorNotifiedAt') ?? ''), principalsNotifiedAt: String(formData.get('principalsNotifiedAt') ?? ''),
  });
  if (!built.ok) redirect(`/compliance/breaches/${enc(id)}?error=${built.error}`);
  try { await adminPatch(`compliance/breaches/${enc(id)}`, { body: built.value }); }
  catch (e) { redirect(`/compliance/breaches/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/compliance/breaches/${id}`);
  revalidatePath('/compliance/breaches');
  redirect(`/compliance/breaches/${enc(id)}?ok=${built.value.action}`);
}

/* ========================= ADMIN-5 · the erasure plane =========================
   Three actions the compliance suite could not previously perform, all from W041/W042. Each maps its own server
   refusals to its OWN error key rather than the generic `conflict`, because on this screen the refusals are
   instructions: "not evidenced" is a list of work outstanding, and "second person" is a colleague to find.          */

function dsrErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    const code = e.code;
    if (code === 'ERASURE_NOT_EVIDENCED') return 'notEvidenced';
    if (code === 'ERASURE_SCOPE_UNAVAILABLE') return 'noScope';
    if (code === 'SECOND_PERSON_REQUIRED') return 'secondPerson';
    if (code === 'DSR_ALREADY_ACKNOWLEDGED') return 'alreadyAcknowledged';
    if (code === 'DSR_INPUT_INVALID') return 'dsrInvalid';
    if (code === 'DSR_ERASURE_COOLING_ACTIVE' || code === 'ERASURE_COOLING_ACTIVE') return 'coolingActive';
  }
  return errorKey(e);
}

/** Reject on one of the three lawful grounds. Separate from `updateDsrAction` because the ground is mandatory here and
 *  meaningless on the other two actions — one form handling all three would have made it optional everywhere, which is
 *  how an ungrounded rejection gets sent. */
export async function rejectDsrAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/compliance');
  const built = buildReject({ ground: String(formData.get('ground') ?? ''), resolution: String(formData.get('resolution') ?? '') });
  if (!built.ok) redirect(`/compliance/dsr/${enc(id)}?error=${built.error}`);
  try { await adminPatch(`compliance/dsr/${enc(id)}`, { body: built.value }); }
  catch (e) { redirect(`/compliance/dsr/${enc(id)}?error=${dsrErrorKey(e)}`); }
  revalidatePath(`/compliance/dsr/${id}`);
  revalidatePath('/compliance');
  redirect(`/compliance/dsr/${enc(id)}?ok=reject`);
}

/** Stamp the DPDP acknowledgement — the 72-hour clock that had no timestamp to measure before migration 0107. */
export async function acknowledgeDsrAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/compliance');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 500) redirect(`/compliance/dsr/${enc(id)}?error=note`);
  try { await adminPost(`compliance/dsr/${enc(id)}/acknowledge`, { body: note ? { note } : {} }); }
  catch (e) { redirect(`/compliance/dsr/${enc(id)}?error=${dsrErrorKey(e)}`); }
  revalidatePath(`/compliance/dsr/${id}`);
  redirect(`/compliance/dsr/${enc(id)}?ok=acknowledged`);
}

/** Record what was ACTUALLY done to one data class. Until an erasure executor exists this is the only thing that can
 *  satisfy the completion guard — which is the point: a completion now has to be earned one class at a time. */
export async function recordErasureActionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/compliance');
  // The scope is not available to a Server Action (it came from the page's fetch), so the law-mismatch check is left to
  // the server here and `null` is passed deliberately rather than a guessed scope. The client-side check still runs on
  // the page's own submit path where the scope IS known.
  const built = buildRecordAction({
    dataClass: String(formData.get('dataClass') ?? ''), action: String(formData.get('action') ?? ''),
    rowsAffected: String(formData.get('rowsAffected') ?? ''), note: String(formData.get('note') ?? ''),
  }, null);
  if (!built.ok) redirect(`/compliance/dsr/${enc(id)}?error=${built.error}`);
  try { await adminPost(`compliance/dsr/${enc(id)}/erasure-actions`, { body: built.value }); }
  catch (e) { redirect(`/compliance/dsr/${enc(id)}?error=${dsrErrorKey(e)}`); }
  revalidatePath(`/compliance/dsr/${id}`);
  redirect(`/compliance/dsr/${enc(id)}?ok=recorded`);
}

/* ========================= ADMIN-5b · the consent notice ladder =========================
   Four actions the console could not previously perform. Each maps the server's refusals to its OWN key, because on this
   screen a refusal is an instruction: `secondPerson` is a colleague to find, `noticeMissing` is a language to write,
   `notDraft` means the words are already what somebody agreed to.                                                    */

function consentErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    const code = e.code;
    if (code === 'SECOND_PERSON_REQUIRED') return 'secondPerson';
    if (code === 'CONSENT_NOTICE_LANGUAGE_MISSING') return 'noticeMissing';
    if (code === 'CONSENT_VERSION_NOT_DRAFT') return 'notDraft';
    if (code === 'CONSENT_DRAFT_OPEN') return 'draftOpen';
    if (code === 'CONSENT_INPUT_INVALID') return 'consentInvalid';
  }
  return errorKey(e);
}

export async function openConsentDraftAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = String(formData.get('code') ?? '').trim();
  if (!code) redirect('/compliance/consent/purposes');
  const built = buildOpenDraft({ changeReason: String(formData.get('changeReason') ?? ''), isMandatory: String(formData.get('isMandatory') ?? '') });
  if (!built.ok) redirect(`/compliance/consent/purposes/${enc(code)}?error=${built.error}`);
  try { await adminPost(`consent/purposes/${enc(code)}/versions`, { body: built.value }); }
  catch (e) { redirect(`/compliance/consent/purposes/${enc(code)}?error=${consentErrorKey(e)}`); }
  revalidatePath(`/compliance/consent/purposes/${code}`);
  redirect(`/compliance/consent/purposes/${enc(code)}?ok=drafted`);
}

export async function saveConsentNoticeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = String(formData.get('code') ?? '').trim();
  const versionId = String(formData.get('versionId') ?? '').trim();
  if (!code || !versionId) redirect('/compliance/consent/purposes');
  const built = buildSaveNotice({
    languageCode: String(formData.get('languageCode') ?? ''),
    noticeText: String(formData.get('noticeText') ?? ''),
    toggleLabel: String(formData.get('toggleLabel') ?? ''),
  });
  if (!built.ok) redirect(`/compliance/consent/purposes/${enc(code)}?error=${built.error}`);
  try { await adminPost(`consent/versions/${enc(versionId)}/notices`, { body: built.value }); }
  catch (e) { redirect(`/compliance/consent/purposes/${enc(code)}?error=${consentErrorKey(e)}`); }
  revalidatePath(`/compliance/consent/purposes/${code}`);
  redirect(`/compliance/consent/purposes/${enc(code)}?ok=noticeSaved`);
}

export async function publishConsentVersionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = String(formData.get('code') ?? '').trim();
  const versionId = String(formData.get('versionId') ?? '').trim();
  if (!code || !versionId) redirect('/compliance/consent/purposes');
  const note = String(formData.get('checkerNote') ?? '').trim();
  if (note.length > 1000) redirect(`/compliance/consent/purposes/${enc(code)}?error=consentInvalid`);
  // Absent rather than empty-string: the DTO is .strict() with min(1), so a blank note must be omitted entirely.
  try { await adminPost(`consent/versions/${enc(versionId)}/publish`, { body: note ? { checkerNote: note } : {} }); }
  catch (e) { redirect(`/compliance/consent/purposes/${enc(code)}?error=${consentErrorKey(e)}`); }
  revalidatePath(`/compliance/consent/purposes/${code}`);
  revalidatePath('/compliance/consent/purposes');
  redirect(`/compliance/consent/purposes/${enc(code)}?ok=published`);
}

export async function discardConsentDraftAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = String(formData.get('code') ?? '').trim();
  const versionId = String(formData.get('versionId') ?? '').trim();
  if (!code || !versionId) redirect('/compliance/consent/purposes');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 3 || reason.length > 1000) redirect(`/compliance/consent/purposes/${enc(code)}?error=changeReason`);
  try { await adminPost(`consent/versions/${enc(versionId)}/discard`, { body: { reason } }); }
  catch (e) { redirect(`/compliance/consent/purposes/${enc(code)}?error=${consentErrorKey(e)}`); }
  revalidatePath(`/compliance/consent/purposes/${code}`);
  redirect(`/compliance/consent/purposes/${enc(code)}?ok=discarded`);
}

/* ========================= ADMIN-5c · the breach notification checklist =========================
   Before this, `notify` needed two timestamps an operator typed. These two actions are what stands behind the word
   "notified" now. Each refusal gets its own key, because each needs a different next move: more evidence, or a
   colleague.                                                                                                        */

function breachErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    const code = e.code;
    if (code === 'BREACH_NOTIFICATION_INCOMPLETE') return 'notEvidenced';
    if (code === 'BREACH_SIGNOFF_REQUIRED') return 'signOffRequired';
    if (code === 'SECOND_PERSON_REQUIRED') return 'secondPerson';
    if (code === 'BREACH_STEP_NOT_FOUND') return 'stepNotFound';
    if (code === 'BREACH_UPDATE_INVALID' || code === 'INVALID_BREACH_UPDATE') return 'looksLikePii';
  }
  return errorKey(e);
}

export async function recordBreachStepAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/compliance/breaches');
  const built = buildRecordStep({
    step: String(formData.get('step') ?? ''), outcome: String(formData.get('outcome') ?? ''),
    evidenceRef: String(formData.get('evidenceRef') ?? ''), reachedCount: String(formData.get('reachedCount') ?? ''),
    channel: String(formData.get('channel') ?? ''), note: String(formData.get('note') ?? ''),
  });
  if (!built.ok) redirect(`/compliance/breaches/${enc(id)}?error=${built.error}`);
  try { await adminPost(`compliance/breaches/${enc(id)}/notification/steps`, { body: built.value }); }
  catch (e) { redirect(`/compliance/breaches/${enc(id)}?error=${breachErrorKey(e)}`); }
  revalidatePath(`/compliance/breaches/${id}`);
  redirect(`/compliance/breaches/${enc(id)}?ok=stepRecorded`);
}

export async function signOffBreachAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/compliance/breaches');
  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) redirect(`/compliance/breaches/${enc(id)}?error=note`);
  // Absent rather than empty-string: the DTO is .strict() with min(1).
  try { await adminPost(`compliance/breaches/${enc(id)}/notification/sign-off`, { body: note ? { note } : {} }); }
  catch (e) { redirect(`/compliance/breaches/${enc(id)}?error=${breachErrorKey(e)}`); }
  revalidatePath(`/compliance/breaches/${id}`);
  redirect(`/compliance/breaches/${enc(id)}?ok=signedOff`);
}
