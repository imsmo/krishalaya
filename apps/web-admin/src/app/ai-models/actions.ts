'use server';
// apps/web-admin/src/app/ai-models/actions.ts · god-mode AI-MODEL mutations — the ONLY place the admin bearer
// writes for the ai/models path. Promoting a model moves it up/down the serving ladder ACROSS every tenant, and
// tuning its confidence threshold changes which inferences go to human review platform-wide — both are
// consequential, so admin-api re-authorises SERVER-SIDE (ai.model.manage + FIDO2 hardware-key + step-up) and
// audits every change with the operator's mandatory `reason`. Lifecycle moves obey the model state machine
// (shadow→canary→production→retired). No Idempotency-Key (admin-api exposes none); no auto-retry. 'use server'
// files export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, AdminApiError } from '../../lib/admin-client';
import { buildPromote, buildTuneThreshold, ModelActionError, isModelStatus, type ModelStatus } from '../../features/ai-models/model';

function apiErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'conflict';   // illegal transition / already in state
    if (e.status === 422) return 'invalid';     // bad input / illegal transition
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
/** Pure-builder validation errors carry a stable i18n field token (e.g. threshold / illegal). */
function inputErrorKey(e: unknown, fallback = 'invalid'): string {
  return e instanceof ModelActionError ? e.fieldKey : fallback;
}
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function promoteModelAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  const fromRaw = str(formData, 'from').trim();
  if (!id || !isModelStatus(fromRaw)) redirect('/ai-models');
  let body;
  try { body = buildPromote(fromRaw as ModelStatus, str(formData, 'to'), str(formData, 'reason')); }
  catch (e) { redirect(`/ai-models/${enc(id)}?error=${inputErrorKey(e, 'illegal')}`); }
  try { await adminPost(`ai/models/${enc(id)}/promote`, { body }); }
  catch (e) { redirect(`/ai-models/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/ai-models/${id}`);
  redirect(`/ai-models/${enc(id)}?ok=promoted`);
}

export async function tuneThresholdAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/ai-models');
  let body;
  try { body = buildTuneThreshold(str(formData, 'confidenceThreshold'), str(formData, 'reason')); }
  catch (e) { redirect(`/ai-models/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await adminPatch(`ai/models/${enc(id)}/threshold`, { body }); }
  catch (e) { redirect(`/ai-models/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/ai-models/${id}`);
  redirect(`/ai-models/${enc(id)}?ok=${body.confidenceThreshold === null ? 'thresholdCleared' : 'threshold'}`);
}

/* ------------------------------------------------------------------------------------------------ */
/* PC-56 ADMIN-7 · THE FAIRNESS GATE                                                                 */
/* ------------------------------------------------------------------------------------------------ */
//
// These are the writes that put a model in front of every farmer on the platform. Each is re-authorised SERVER-SIDE:
// `ai.model.manage`, a FIDO2 hardware key, and step-up re-auth freshness — plus, for a production transition, a fairness
// audit record that 0115 makes a database requirement rather than a convention.
//
// NO VERDICT, NO GAP AND NO AUDIT ID IS SENT. The approve request has no body at all. The gate is re-evaluated inside the
// server's transaction, because a client that could supply `pass: true` could promote a model with a 40pp district gap —
// and that verdict is the only thing standing between a skewed model and production.

/** W085's "Schedule audit", run now. */
export async function runAuditAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/ai-models');
  try {
    await adminPost(`ai/models/${encodeURIComponent(id)}/fairness/audit`, { body: {} });
  } catch (e) {
    redirect(`/ai-models/${encodeURIComponent(id)}/rollout?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/ai-models/${id}/rollout`);
  revalidatePath('/ai-models/fairness');
  // `?ok=audited` deliberately does NOT say "passed". The verdict is whatever the measurements produced, and a success
  // banner implying a clean result would be the console asserting an outcome it did not compute.
  redirect(`/ai-models/${encodeURIComponent(id)}/rollout?ok=audited`);
}

/** The DPO's sign-off on the slice definitions — a different permission (`compliance.manage`) because deciding to measure
 *  accuracy by gender means deciding to process gender. */
export async function approveSlicesAction(formData: FormData): Promise<void> {
  requireAdmin();
  const auditId = String(formData.get('auditId') ?? '').trim();
  const modelId = String(formData.get('modelId') ?? '').trim();
  if (!auditId) redirect('/ai-models/fairness');
  try {
    await adminPost(`ai/models/fairness/audits/${encodeURIComponent(auditId)}/approve-slices`, { body: {} });
  } catch (e) {
    redirect(`/ai-models/fairness?error=${apiErrorKey(e)}`);
  }
  revalidatePath('/ai-models/fairness');
  if (modelId) revalidatePath(`/ai-models/${modelId}/rollout`);
  redirect('/ai-models/fairness?ok=slicesApproved');
}

/** Propose a transition — the maker half of the eleventh maker-checker site. */
export async function proposeTransitionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const to = String(formData.get('to') ?? '').trim();
  const reason = String(formData.get('reason') ?? '');
  const pctRaw = String(formData.get('canaryPercent') ?? '').trim();
  if (!id) redirect('/ai-models');
  if (!isModelStatus(to)) redirect(`/ai-models/${encodeURIComponent(id)}/rollout?error=invalid`);
  // Checked here so the operator sees a field error rather than a 409, and checked again by Zod and again by the service.
  if (reason.trim().length < 20) redirect(`/ai-models/${encodeURIComponent(id)}/rollout?error=reason`);

  const body: Record<string, unknown> = { to, reason: reason.trim() };
  // The share is sent ONLY for a canary. Sending it for a production transition would have the server store a traffic
  // split on a model that carries all of it, which `ck_ai_model_canary_percent` refuses — correctly.
  if (to === 'canary') {
    const pct = Number(pctRaw);
    if (!Number.isFinite(pct)) redirect(`/ai-models/${encodeURIComponent(id)}/rollout?error=canaryPct`);
    body.canaryPercent = pct;
  }
  try {
    await adminPost(`ai/models/${encodeURIComponent(id)}/transitions`, { body });
  } catch (e) {
    redirect(`/ai-models/${encodeURIComponent(id)}/rollout?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/ai-models/${id}/rollout`);
  redirect(`/ai-models/${encodeURIComponent(id)}/rollout?ok=proposed`);
}

/** Approve a transition — the checker half, and where the gate fires. NO BODY. */
export async function approveTransitionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/ai-models');
  try {
    await adminPost(`ai/models/${encodeURIComponent(id)}/transitions/approve`, { body: {} });
  } catch (e) {
    redirect(`/ai-models/${encodeURIComponent(id)}/rollout?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/ai-models/${id}/rollout`);
  revalidatePath('/ai-models');
  redirect(`/ai-models/${encodeURIComponent(id)}/rollout?ok=promoted`);
}

export async function withdrawTransitionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/ai-models');
  try {
    await adminPost(`ai/models/${encodeURIComponent(id)}/transitions/withdraw`, { body: {} });
  } catch (e) {
    redirect(`/ai-models/${encodeURIComponent(id)}/rollout?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/ai-models/${id}/rollout`);
  redirect(`/ai-models/${encodeURIComponent(id)}/rollout?ok=withdrawn`);
}

/* ------------------------------------------------------------------------------------------------ */
/* W082 + W083 · THE REVIEW QUEUE                                                                    */
/* ------------------------------------------------------------------------------------------------ */

/** Take a case. Cases are single-owner so two officers cannot reach conflicting decisions on the same farmer's listing.
 *  Not step-up gated: claiming is reversible, and making the safe first step expensive is how a queue goes unworked. */
export async function claimCaseAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/ai-models/review');
  try {
    await adminPost(`ai/review/cases/${encodeURIComponent(id)}/claim`, { body: {} });
  } catch (e) {
    redirect(`/ai-models/review/${encodeURIComponent(id)}?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/ai-models/review/${id}`);
  redirect(`/ai-models/review/${encodeURIComponent(id)}?ok=claimed`);
}

/** Decide a case. Step-up gated: an accept on a fraud flag holds a farmer's listing off the market, and a reject releases
 *  a listing the model thought fraudulent — both are consequential for somebody outside this building. */
export async function decideCaseAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const decision = String(formData.get('decision') ?? '').trim();
  const note = String(formData.get('note') ?? '');
  if (!id) redirect('/ai-models/review');
  if (decision !== 'accept' && decision !== 'reject') {
    redirect(`/ai-models/review/${encodeURIComponent(id)}?error=invalid`);
  }
  // The note is what the model learns from and what W085's override analysis is built out of; an empty one throws the
  // signal away, so the floor is checked here, by Zod, and by 0115's CHECK.
  if (note.trim().length < 20) redirect(`/ai-models/review/${encodeURIComponent(id)}?error=note`);
  try {
    await adminPost(`ai/review/cases/${encodeURIComponent(id)}/decide`, { body: { decision, note: note.trim() } });
  } catch (e) {
    redirect(`/ai-models/review/${encodeURIComponent(id)}?error=${apiErrorKey(e)}`);
  }
  revalidatePath(`/ai-models/review/${id}`);
  revalidatePath('/ai-models/review');
  redirect(`/ai-models/review/${encodeURIComponent(id)}?ok=${decision === 'accept' ? 'accepted' : 'rejected'}`);
}
