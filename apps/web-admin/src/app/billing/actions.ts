'use server';
// apps/web-admin/src/app/billing/actions.ts · god-mode SaaS-billing mutations. The ONLY place the admin bearer
// writes for the billing path. Each is re-authorised SERVER-SIDE by admin-api (owner perm + FIDO2 hardware-key +
// step-up — consequential billing/money controls, Law 11) and carries the operator's mandatory audit reason. The
// adjustment is a MONEY MOVE (service → wallet-service): it carries a client-supplied idempotencyKey in the body
// (a fresh randomUUID here) so a double-submit/refresh never double-posts; amount stays a minor-unit STRING (Law 2,
// never floated). 'use server' modules export ONLY async functions — validation lives in features/billing/billing.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, AdminApiError } from '../../lib/admin-client';
import { buildAdjustment, buildDunning, validReason } from '../../features/billing/billing';
import { buildPayment, buildDecision, buildLadder, parseSuspendAfterDays } from '../../features/billing/money-controls';
import { buildBulk } from '../../features/billing/reporting';
import { buildSchedule } from '../../features/billing/live';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'illegal';
    if (e.status === 404) return 'notFound';
    if (e.status === 422) return 'amount';
  }
  return 'generic';
}

export async function updateInvoiceAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const action = String(formData.get('action') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (!id) redirect('/billing/invoices');
  if (!['issue', 'mark_overdue', 'void'].includes(action)) redirect(`/billing/invoices/${encodeURIComponent(id)}?error=generic`);
  if (!validReason(reason)) redirect(`/billing/invoices/${encodeURIComponent(id)}?error=reason`);
  try { await adminPatch(`billing/invoices/${encodeURIComponent(id)}`, { body: { action, reason: reason.trim() } }); }
  catch (e) { redirect(`/billing/invoices/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/billing/invoices/${id}`);
  redirect(`/billing/invoices/${encodeURIComponent(id)}?ok=${action}`);
}

export async function recordDunningAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/billing/invoices');
  const built = buildDunning({
    channel: String(formData.get('channel') ?? ''),
    outcome: String(formData.get('outcome') ?? ''),
    note: String(formData.get('note') ?? ''),
  });
  if (!built.ok) redirect(`/billing/invoices/${encodeURIComponent(id)}?error=${built.error}`);
  try { await adminPost(`billing/invoices/${encodeURIComponent(id)}/dunning`, { body: built.value }); }
  catch (e) { redirect(`/billing/invoices/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/billing/invoices/${id}`);
  redirect(`/billing/invoices/${encodeURIComponent(id)}?ok=dunning`);
}

/** PC-56 ADMIN-1 · record a dunning touch FROM THE COLLECTION QUEUE. Same server call as the invoice page (one
 *  write path, one set of guards); what differs is where the operator is standing. Returning them to the queue with
 *  their tier filter intact is not cosmetic — a collections officer works a list top-to-bottom, and a redirect that
 *  dropped the filter would silently restart them on a different set of debtors. */
export async function recordDunningFromQueueAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const tier = String(formData.get('tier') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/billing/dunning?${tier ? `tier=${encodeURIComponent(tier)}&` : ''}${qs}`);
  if (!id) back('error=notFound');
  const built = buildDunning({
    channel: String(formData.get('channel') ?? ''),
    outcome: String(formData.get('outcome') ?? ''),
    note: String(formData.get('note') ?? ''),
  });
  if (!built.ok) back(`error=${built.error}`);
  try { await adminPost(`billing/invoices/${encodeURIComponent(id)}/dunning`, { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath('/billing/dunning');
  revalidatePath(`/billing/invoices/${id}`);
  back('ok=dunning');
}

export async function applyAdjustmentAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildAdjustment({
    tenantId: String(formData.get('tenantId') ?? ''),
    direction: String(formData.get('direction') ?? ''),
    amountMinor: String(formData.get('amountMinor') ?? ''),
    currency: String(formData.get('currency') ?? ''),
    reason: String(formData.get('reason') ?? ''),
    subscriptionId: String(formData.get('subscriptionId') ?? ''),
    invoiceId: String(formData.get('invoiceId') ?? ''),
  });
  if (!built.ok) redirect(`/billing/adjustments?error=${built.error}`);
  // PC-56 ADMIN-1b: this REQUESTS the adjustment (0093 maker-checker) — no money moves here, and no idempotency key
  // is sent: the wallet key is minted server-side at APPLY time, so an approve→reject→resubmit cycle cannot reuse a
  // key and turn the corrected adjustment into a silent no-op at the wallet.
  try { await adminPost('billing/adjustments', { body: built.value }); }
  catch (e) { redirect(`/billing/adjustments?error=${errorKey(e)}`); }
  revalidatePath('/billing/adjustments');
  redirect('/billing/adjustments?ok=requested');
}

/** CHECKER: approve / return / reject a pending adjustment. A different operator from the requester — the DB refuses
 *  otherwise (0093) and a 403 here is translated into a sentence, not a stack trace. */
export async function decideAdjustmentAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/billing/adjustments?error=notFound');
  const built = buildDecision({
    decision: String(formData.get('decision') ?? ''),
    note: String(formData.get('note') ?? ''),
  });
  if (!built.ok) redirect(`/billing/adjustments?error=adj_${built.error}`);
  try { await adminPost(`billing/adjustments/${encodeURIComponent(id)}/decision`, { body: built.value }); }
  catch (e) { redirect(`/billing/adjustments?error=${errorKey(e)}`); }
  revalidatePath('/billing/adjustments');
  redirect(`/billing/adjustments?ok=${built.value.decision === 'approve' ? 'approved' : built.value.decision === 'return' ? 'returned' : 'rejected'}`);
}

/** APPLY: the money leg, and the only call here that moves value. Separate from approval on purpose — a wallet
 *  failure leaves the approval standing, so the retry is one click and never a fresh approval cycle. */
export async function applyApprovedAdjustmentAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/billing/adjustments?error=notFound');
  try { await adminPost(`billing/adjustments/${encodeURIComponent(id)}/apply`, { body: {} }); }
  catch (e) { redirect(`/billing/adjustments?error=${errorKey(e)}`); }
  revalidatePath('/billing/adjustments');
  redirect('/billing/adjustments?ok=applied');
}

// ---------------------------------------------------------------------------
// Payments (PC-56 ADMIN-1b · closes ADMIN-1-Q1)
// ---------------------------------------------------------------------------
/** Record money RECEIVED against an invoice. The invoice's own currency is passed through a hidden field — NOT chosen
 *  by the operator — so a receipt can never be filed in a currency the invoice was not raised in. */
export async function recordPaymentAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/billing/invoices');
  const back: (qs: string) => never = (qs) => redirect(`/billing/invoices/${encodeURIComponent(id)}?${qs}`);
  const built = buildPayment({
    amountMajor: String(formData.get('amountMajor') ?? ''),
    method: String(formData.get('method') ?? ''),
    reference: String(formData.get('reference') ?? ''),
    receivedAt: String(formData.get('receivedAt') ?? ''),
    note: String(formData.get('note') ?? ''),
  }, String(formData.get('currency') ?? ''), majorToMinor, new Date().toISOString());
  if (!built.ok) back(`error=pay_${built.error}`);
  try {
    await adminPost(`billing/invoices/${encodeURIComponent(id)}/payments`, {
      // the caller's key: a double-submit or a refresh books the money once (Law 3)
      body: { ...built.value, idempotencyKey: randomUUID() },
    });
  } catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/billing/invoices/${id}`);
  revalidatePath('/billing/dunning');
  back('ok=payment');
}

/** Reverse a payment that did not really arrive (bounced cheque / wrong invoice). Append-only server-side: this adds
 *  a negative mirror row, it does not delete anything, and the invoice reopens by arithmetic. */
export async function reversePaymentAction(formData: FormData): Promise<void> {
  requireAdmin();
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const paymentId = String(formData.get('paymentId') ?? '').trim();
  if (!invoiceId || !paymentId) redirect('/billing/invoices');
  const back: (qs: string) => never = (qs) => redirect(`/billing/invoices/${encodeURIComponent(invoiceId)}?${qs}`);
  const reason = String(formData.get('reason') ?? '');
  if (!validReason(reason)) back('error=reason');
  try { await adminPost(`billing/payments/${encodeURIComponent(paymentId)}/reverse`, { body: { reason: reason.trim() } }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/billing/invoices/${invoiceId}`);
  revalidatePath('/billing/dunning');
  back('ok=reversed');
}

// ---------------------------------------------------------------------------
// Dunning policy (PC-56 ADMIN-1b · closes ADMIN-1-Q6)
// ---------------------------------------------------------------------------
/** Publish a NEW ladder version. Never an edit: the previous version is why a tenant was chased the way they were.
 *  The step rows arrive as parallel arrays from the form and are zipped back together here. */
export async function publishDunningPolicyAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back: (qs: string) => never = (qs) => redirect(`/billing/dunning/policy?${qs}`);
  const days = formData.getAll('dayOffset').map(String);
  const channels = formData.getAll('channel').map(String);
  const templates = formData.getAll('templateCode').map(String);
  const escalates = new Set(formData.getAll('escalate').map(String));
  const rows = days.map((d, i) => ({
    dayOffset: d, channel: channels[i] ?? '', templateCode: templates[i] ?? '',
    // a checkbox only appears in the payload when ticked, so its VALUE carries the row index
    escalate: escalates.has(String(i)),
  }));

  const suspend = parseSuspendAfterDays(String(formData.get('suspendAfterDays') ?? ''));
  if (suspend === 'bad') back('error=pol_suspend');
  const ladder = buildLadder(rows, suspend);
  if (!ladder.ok) back(`error=pol_${ladder.error}${ladder.at !== undefined ? `&row=${ladder.at + 1}` : ''}`);

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 3 || name.length > 120) back('error=pol_name');
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) back('error=pol_effectiveFrom');
  const notes = String(formData.get('notes') ?? '').trim();

  try {
    await adminPost('billing/dunning-policy', {
      body: {
        name, effectiveFrom, notes: notes || undefined,
        ...(suspend === null ? {} : { suspendAfterDays: suspend }),
        steps: ladder.value.map((s) => ({
          dayOffset: s.dayOffset, channel: s.channel,
          ...(s.templateCode ? { templateCode: s.templateCode } : {}), escalate: s.escalate,
        })),
      },
    });
  } catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath('/billing/dunning/policy');
  revalidatePath('/billing/dunning');
  back('ok=published');
}

/** ₹ major units → paise, integer-only. A regex, not parseFloat: "1234.50" must become 123450 exactly, and
 *  `Number('0.145') * 100` is 14.499999999999998 (Law 2 — money never touches a float). */
function majorToMinor(major: string): string | undefined {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(major.trim());
  if (!m) return undefined;
  return String(BigInt(m[1]) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0')));
}

// ---------------------------------------------------------------------------
// BULK invoice transitions (PC-56 ADMIN-1d · closes ADMIN-1-Q11)
// ---------------------------------------------------------------------------
/**
 * Apply one action to many invoices. The selection arrives as checkbox values of `<id>:<status>`, so the action knows
 * each row's status WITHOUT a second read — which is what lets it drop the inapplicable ones locally and tell the
 * operator how many were skipped.
 *
 * Why drop them here rather than let the server report them as `illegal`: the recorded batch should equal the real
 * intent. A batch audit row listing invoices the operator never meant to touch is a worse record than a smaller,
 * accurate one — and the count is still reported, so nothing is hidden.
 */
export async function bulkInvoiceAction(formData: FormData): Promise<void> {
  requireAdmin();
  const status = String(formData.get('listStatus') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/billing/invoices?${status ? `status=${encodeURIComponent(status)}&` : ''}${qs}`);

  const selected = formData.getAll('selected').map(String).map((v) => {
    const [id, st] = v.split(':');
    return { id, status: st ?? '' };
  }).filter((r) => !!r.id);

  const built = buildBulk({
    action: String(formData.get('action') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  }, selected);
  if (!built.ok) back(`error=bulk_${built.error}`);

  interface BulkEnvelope { moved?: number; illegal?: number; notFound?: number; failed?: number }
  let res: BulkEnvelope | undefined;
  try { res = (await adminPost<BulkEnvelope>('billing/invoices/bulk', { body: built.value })).data; }
  catch (e) { back(`error=${errorKey(e)}`); }

  revalidatePath('/billing/invoices');
  revalidatePath('/billing/dunning');
  // The outcome travels in the URL so the page can state exactly what happened — including the locally skipped rows,
  // which the server never saw and therefore cannot report.
  const parts = [
    `ok=bulk`, `moved=${res?.moved ?? 0}`, `skipped=${built.skipped}`,
    `illegal=${res?.illegal ?? 0}`, `notfound=${res?.notFound ?? 0}`, `failed=${res?.failed ?? 0}`,
  ];
  back(parts.join('&'));
}

// ---------------------------------------------------------------------------
// Scheduled reports (PC-56 ADMIN-1e · closes ADMIN-1-Q9)
// ---------------------------------------------------------------------------
/** Create a schedule. It records a RULE — nothing is sent here, and no "send the first one now" shortcut exists,
 *  because a create button that also delivers is not what anyone reading the form expects. */
export async function createScheduleAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back: (qs: string) => never = (qs) => redirect(`/billing/schedules?${qs}`);
  const built = buildSchedule({
    report: String(formData.get('report') ?? ''),
    cadence: String(formData.get('cadence') ?? ''),
    hourIst: String(formData.get('hourIst') ?? ''),
    weekdayIso: String(formData.get('weekdayIso') ?? ''),
    recipients: String(formData.get('recipients') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  }, ['tenants', 'plans', 'invoices', 'gstr', 'revenue']);
  if (!built.ok) back(`error=sch_${built.error}`);
  try { await adminPost('billing/schedules', { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath('/billing/schedules');
  back('ok=created');
}

/** Pause or resume. Resuming RECOMPUTES the next run server-side, so a schedule paused for a month does not fire the
 *  instant it wakes up. */
export async function toggleScheduleAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/billing/schedules?${qs}`);
  if (!id) back('error=notFound');
  const active = String(formData.get('active') ?? 'true') === 'true';
  const reason = String(formData.get('reason') ?? '');
  if (!validReason(reason)) back('error=sch_reason');
  try { await adminPost(`billing/schedules/${encodeURIComponent(id)}/active`, { body: { active, reason: reason.trim() } }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath('/billing/schedules');
  back(`ok=${active ? 'resumed' : 'paused'}`);
}
