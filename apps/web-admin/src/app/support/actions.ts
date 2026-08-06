'use server';
// apps/web-admin/src/app/support/actions.ts · god-mode support-oversight mutation. The ONLY consequential write
// in this surface and the ONLY place the admin bearer writes for the support path: a platform operator ESCALATES
// a tenant's ticket (raise severity / move to 'escalated' / reassign to a platform lead) when the tenant's support
// is failing its SLA. admin-api re-authorises SERVER-SIDE (support.oversight.manage + FIDO2 hardware-key +
// step-up — a cross-tenant override, Law 11) and records an audit row, so the operator's mandatory `reason` goes
// in the body. Support is money-free. No Idempotency-Key (admin-api exposes none); mutations never auto-retry.
// 'use server' files export ONLY async functions — validation lives in features/support/ticket.ts.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../lib/admin-client';
import { buildEscalate } from '../../features/support/ticket';
import { buildMacro } from '../../features/support/desk';
import { buildPolicy } from '../../features/support/policy';

/** A reason is mandatory on anything that changes what the desk shows other people (mirrors the server's zod Reason). */
function validReason(reason: string | null | undefined): boolean {
  const r = String(reason ?? '').trim();
  return r.length >= 3 && r.length <= 1000;
}

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 422) return 'invalid';     // SUPPORT_ESCALATION_INVALID (no-op / would-lower)
    if (e.status === 409) return 'illegal';     // illegal status transition
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
const enc = encodeURIComponent;

export async function escalateTicketAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/support');
  const built = buildEscalate({
    severity: String(formData.get('severity') ?? ''),
    reassignToUserId: String(formData.get('reassignToUserId') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  });
  if (!built.ok) redirect(`/support/tickets/${enc(id)}?error=${built.error}`);
  try { await adminPost(`support/tickets/${enc(id)}/escalate`, { body: built.value }); }
  catch (e) { redirect(`/support/tickets/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/support/tickets/${id}`);
  revalidatePath('/support');
  revalidatePath('/support/sla-breaches');
  redirect(`/support/tickets/${enc(id)}?ok=escalated`);
}

// ---------------------------------------------------------------------------
// Support macros (PC-56 ADMIN-2 · canon W053)
// ---------------------------------------------------------------------------
/** Author a canned answer. Not elevated beyond the write permission: it moves no money and touches no tenant record —
 *  over-gating a harmless control trains people to treat elevation prompts as noise. */
export async function createMacroAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back: (qs: string) => never = (qs) => redirect(`/support/macros?${qs}`);
  const built = buildMacro({
    slug: String(formData.get('slug') ?? ''),
    title: String(formData.get('title') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    bodies: {
      en: String(formData.get('body_en') ?? ''),
      hi: String(formData.get('body_hi') ?? ''),
      gu: String(formData.get('body_gu') ?? ''),
    },
  });
  if (!built.ok) back(`error=mac_${built.error}${built.at ? `&lang=${built.at}` : ''}`);
  try { await adminPost('support/macros', { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath('/support/macros');
  back(`ok=created&missing=${built.value.bodies.length === 3 ? '0' : String(3 - built.value.bodies.length)}`);
}

/** Archive or restore. Never a delete — a macro used on a ticket must stay readable, or that ticket's history becomes a
 *  reply nobody can account for. */
export async function toggleMacroAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/support/macros?${qs}`);
  if (!id) back('error=notFound');
  const active = String(formData.get('active') ?? 'true') === 'true';
  const reason = String(formData.get('reason') ?? '');
  if (!validReason(reason)) back('error=mac_reason');
  try { await adminPost(`support/macros/${encodeURIComponent(id)}/active`, { body: { active, reason: reason.trim() } }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath('/support/macros');
  back(`ok=${active ? 'restored' : 'archived'}`);
}

// ---------------------------------------------------------------------------
// The SUPPORT POLICY (PC-56 ADMIN-2b · canon W054 + W057)
// ---------------------------------------------------------------------------
/**
 * PUBLISH a new policy version. Elevated, unlike a macro: this decides who is woken at 02:00 and what the platform
 * promises a farmer about their money problem. Over-gating a harmless control trains people to click through elevation
 * prompts; under-gating this one means a policy can be quietly loosened.
 *
 * THE SERVER OWNS THE COHERENCE RULES. buildPolicy checks shape only. When admin-api's assertPolicy refuses (422), its
 * message is passed through to the page VERBATIM rather than mapped to a generic string — the operator needs to read
 * "P1 must have MORE first-response time than P0", not "invalid policy".
 */
export async function publishSupportPolicyAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back: (qs: string) => never = (qs) => redirect(`/support/escalation?${qs}`);
  const built = buildPolicy(
    (n) => String(formData.get(n) ?? ''),
    (n) => formData.getAll(n).map((v) => String(v)),
  );
  if (!built.ok) back(`error=pol_${built.error}${built.at ? `&at=${enc(built.at)}` : ''}`);
  try { await adminPost('support/policy', { body: built.value }); }
  catch (e) {
    // 422 carries the real reason; anything else is mapped as usual
    if (e instanceof AdminApiError && e.status === 422) back(`error=pol_rejected&why=${enc(e.message.slice(0, 300))}`);
    back(`error=${errorKey(e)}`);
  }
  revalidatePath('/support/escalation');
  revalidatePath('/support');            // the queue's SLA column reads the same targets
  revalidatePath('/support/sla-breaches');
  back('ok=published');
}

// ---------------------------------------------------------------------------
// RESOLVING from the oversight plane (PC-56 ADMIN-2b · canon W049)
// ---------------------------------------------------------------------------
/**
 * Close a ticket the platform has actually dealt with, with a MANDATORY outcome.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: message the farmer. A reply is part of the ticket's conversation and its
 * notification fan-out lives in apps/api; writing one from the admin realm would leave the ticket looking answered to
 * everybody except the person waiting for it. The page says so where an operator would otherwise assume otherwise.
 */
export async function resolveTicketAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/support');
  const back: (qs: string) => never = (qs) => redirect(`/support/tickets/${enc(id)}?${qs}`);
  const outcome = String(formData.get('outcome') ?? '').trim();
  if (outcome.length < 10 || outcome.length > 2000) back('error=outcome');
  try { await adminPost(`support/tickets/${enc(id)}/resolve`, { body: { outcome } }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/support/tickets/${id}`);
  revalidatePath('/support');
  revalidatePath('/support/sla-breaches');
  back('ok=resolved');
}
