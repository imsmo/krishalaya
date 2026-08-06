// apps/web-admin/src/features/billing/money-controls.ts · PURE console rules for the three money controls built in
// PC-56 ADMIN-1b: recording a payment (Q1), the adjustment maker-checker (Q5), and the collections ladder (Q6).
// No IO, no React → unit-provable. Every gate here MIRRORS a server rule; none of them grants anything.
//
// WHAT THIS FILE IS FOR. The server now refuses the wrong thing in every case — self-approval is a DB CHECK, a
// foreign-currency payment is a 422, applying an unapproved adjustment is a 409. So the console's job is not to
// protect the platform; it is to make sure nobody is invited to do something that will be refused, and that when a
// control is absent the page can say WHY. A disabled button with no explanation is how an operator learns to
// distrust the tool and start asking a colleague to "just do it on their login".

// ---------------------------------------------------------------------------
// Payments (ADMIN-1-Q1)
// ---------------------------------------------------------------------------
/** Mirrors the 0092 CHECK + the domain vocabulary. `offset` is the non-cash case (a credit note settling part of an
 *  invoice) and is listed last because it is not money in a bank account and a reconciler must not expect to find it
 *  on a statement. */
export const PAYMENT_METHODS = ['bank_transfer', 'upi', 'cheque', 'card', 'netbanking', 'wallet', 'cash', 'offset'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentRow {
  id?: string;
  amountMinor?: string | null;
  currency?: string | null;
  method?: string | null;
  reference?: string | null;
  receivedAt?: string | null;
  walletTxnId?: string | null;
  reversesPaymentId?: string | null;
  note?: string | null;
}

/** A reversal is the negative mirror of the row it corrects (0092). Identified by the link, not by the sign, because
 *  the link is what tells the reader WHICH payment was undone. */
export function isReversal(p: PaymentRow): boolean { return !!p.reversesPaymentId; }

/** Ids of payments that have already been reversed, so the page offers "reverse" exactly once per payment. */
export function reversedIds(payments: readonly PaymentRow[]): Set<string> {
  const out = new Set<string>();
  for (const p of payments) if (p.reversesPaymentId) out.add(String(p.reversesPaymentId));
  return out;
}

/** Why a payment cannot be reversed, so the page says it instead of hiding the control:
 *   • `already_reversed` — one reversal per payment, ever (0092 unique index);
 *   • `is_reversal`      — a reversal is not itself reversible; record a fresh payment instead. */
export type ReverseBlock = 'none' | 'already_reversed' | 'is_reversal';
export function reverseBlockedReason(p: PaymentRow, reversed: ReadonlySet<string>): ReverseBlock {
  if (isReversal(p)) return 'is_reversal';
  if (p.id && reversed.has(String(p.id))) return 'already_reversed';
  return 'none';
}
export function canReverse(p: PaymentRow, reversed: ReadonlySet<string>): boolean {
  return reverseBlockedReason(p, reversed) === 'none';
}

/** Statuses that can receive money (mirrors `assertPayable`). The form is absent otherwise — and the page explains
 *  which of the three reasons applies rather than showing a dead field. */
const PAYABLE: ReadonlySet<string> = new Set(['issued', 'partially_paid', 'overdue']);
export type PayableBlock = 'none' | 'draft_not_sent' | 'already_paid' | 'void_written_off';
export function payableBlockedReason(status: string | null | undefined): PayableBlock {
  const s = String(status ?? '');
  if (PAYABLE.has(s)) return 'none';
  if (s === 'draft') return 'draft_not_sent';
  if (s === 'paid') return 'already_paid';
  if (s === 'void') return 'void_written_off';
  return 'draft_not_sent';
}
export function canRecordPayment(status: string | null | undefined): boolean {
  return payableBlockedReason(status) === 'none';
}

const MINOR_RE = /^\d{1,15}$/;

export type PaymentError = 'amount' | 'reference' | 'method' | 'receivedAt' | 'future' | 'currency';
export type PaymentResult =
  | { ok: true; value: { amountMinor: string; currency: string; method: PaymentMethod; reference: string; receivedAt: string; note?: string } }
  | { ok: false; error: PaymentError };

/**
 * Build the record-payment body. Money stays a MINOR-UNIT STRING throughout — the operator types major units and a
 * caller-supplied converter turns them into minor units, so no float ever touches the amount (Law 2).
 *
 * The currency is NOT a field on the form: it is the invoice's, passed in. A currency selector here would invite an
 * operator to record a USD receipt against an INR invoice, and the server would (correctly) refuse — but only after
 * they had typed everything, and only with a message about FX they did not expect.
 */
export function buildPayment(
  raw: { amountMajor: string; method: string; reference: string; receivedAt: string; note?: string },
  invoiceCurrency: string,
  toMinor: (major: string) => string | undefined,
  nowIso: string,
): PaymentResult {
  if (!(PAYMENT_METHODS as readonly string[]).includes(raw.method)) return { ok: false, error: 'method' };
  const cur = String(invoiceCurrency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return { ok: false, error: 'currency' };

  const minor = toMinor(raw.amountMajor.trim());
  if (!minor || !MINOR_RE.test(minor) || minor === '0') return { ok: false, error: 'amount' };

  const reference = raw.reference.trim();
  if (reference.length < 3 || reference.length > 120) return { ok: false, error: 'reference' };

  const at = raw.receivedAt.trim();
  const ts = Date.parse(at);
  if (!at || !Number.isFinite(ts)) return { ok: false, error: 'receivedAt' };
  // mirrors RECEIVED_AT_FUTURE_TOLERANCE_MS: a payment dated tomorrow would age the invoice wrongly for a day
  if (ts > Date.parse(nowIso) + 5 * 60 * 1000) return { ok: false, error: 'future' };

  const value: { amountMinor: string; currency: string; method: PaymentMethod; reference: string; receivedAt: string; note?: string } = {
    amountMinor: minor, currency: cur, method: raw.method as PaymentMethod, reference, receivedAt: new Date(ts).toISOString(),
  };
  const note = (raw.note ?? '').trim();
  if (note) value.note = note.slice(0, 1000);
  return { ok: true, value };
}

/** The invoice's money picture, from the server's own numbers. Nothing is recomputed from the payment rows here —
 *  the API sends `paidMinor`/`outstandingMinor`/`overpaidMinor` derived from the same SUM that drove the status, and a
 *  second, local derivation is exactly how a page ends up disagreeing with the invoice it is displaying. */
export interface MoneyPicture {
  totalMinor?: string | null; paidMinor?: string | null; outstandingMinor?: string | null; overpaidMinor?: string | null;
}
export function isOverpaid(m: MoneyPicture): boolean {
  const v = String(m.overpaidMinor ?? '0');
  return /^\d+$/.test(v) && BigInt(v) > 0n;
}
export function isSettled(m: MoneyPicture): boolean {
  const v = String(m.outstandingMinor ?? '');
  return /^\d+$/.test(v) && BigInt(v) === 0n;
}

// ---------------------------------------------------------------------------
// Adjustment maker-checker (ADMIN-1-Q5)
// ---------------------------------------------------------------------------
export const ADJUSTMENT_STATUSES = ['awaiting_approval', 'approved', 'applied', 'returned', 'rejected'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];
export function isAdjustmentStatus(v: string | null | undefined): v is AdjustmentStatus {
  return !!v && (ADJUSTMENT_STATUSES as readonly string[]).includes(v);
}

export interface AdjustmentRow {
  id?: string; tenantId?: string | null; direction?: string | null; amountMinor?: string | null;
  currency?: string | null; reason?: string | null; status?: string | null;
  requestedBy?: string | null; decidedBy?: string | null; decisionNote?: string | null;
  walletTxnId?: string | null; appliedAt?: string | null; createdAt?: string | null;
}

/**
 * What this viewer may do to this request.
 *
 * MAKER ≠ CHECKER BY ABSENCE. The requester is offered NOTHING on their own request — not a disabled button, not a
 * tooltip: the controls are simply not there, and a line of text explains that a second approver is needed. The
 * database refuses self-approval (0093 `ck_billing_adj_maker_ne_checker`) and the service returns 403, so rendering
 * the buttons would only teach an operator that the control is decorative.
 *
 * `apply` is deliberately a SEPARATE act from `approve`: approving says the money should move, applying moves it.
 * Keeping them apart is what makes a wallet failure recoverable — the approval survives, and the retry is one click.
 */
export function adjustmentActions(row: AdjustmentRow, viewerUserId: string | null): Array<'approve' | 'return' | 'reject' | 'apply'> {
  const status = String(row.status ?? '');
  const isMaker = !!viewerUserId && !!row.requestedBy && viewerUserId === row.requestedBy;
  if (status === 'awaiting_approval') return isMaker ? [] : ['approve', 'return', 'reject'];
  // Applying is the money leg. The approver may apply what they approved — that is not self-approval, the second pair
  // of eyes has already been through — but the MAKER still may not, or the control would be a two-click bypass.
  if (status === 'approved') return isMaker ? [] : ['apply'];
  return [];
}

/** Why this viewer is offered nothing, in words the page can print. */
export type AdjustmentBlock = 'none' | 'you_requested_it' | 'already_applied' | 'closed';
export function adjustmentBlockedReason(row: AdjustmentRow, viewerUserId: string | null): AdjustmentBlock {
  const status = String(row.status ?? '');
  if (status === 'applied') return 'already_applied';
  if (status === 'returned' || status === 'rejected') return 'closed';
  if (viewerUserId && row.requestedBy && viewerUserId === row.requestedBy) return 'you_requested_it';
  return 'none';
}

/** A refusal must carry a note (mirrors the 0093 CHECK and the zod refine). Approval may be silent — agreeing with a
 *  documented request adds nothing by restating it. */
export type DecisionError = 'decision' | 'note';
export type DecisionResult =
  | { ok: true; value: { decision: 'approve' | 'return' | 'reject'; note?: string } }
  | { ok: false; error: DecisionError };
export function buildDecision(raw: { decision: string; note?: string }): DecisionResult {
  if (!['approve', 'return', 'reject'].includes(raw.decision)) return { ok: false, error: 'decision' };
  const decision = raw.decision as 'approve' | 'return' | 'reject';
  const note = (raw.note ?? '').trim();
  if (decision !== 'approve' && note.length < 3) return { ok: false, error: 'note' };
  return { ok: true, value: note ? { decision, note: note.slice(0, 1000) } : { decision } };
}

/** True when the row represents money that has actually moved. Used to label the row honestly: everything else is a
 *  request, however far through the workflow it is. */
export function moneyHasMoved(row: AdjustmentRow): boolean {
  return String(row.status ?? '') === 'applied' && !!row.walletTxnId;
}

/** Count of requests waiting for someone else's eyes — the number that belongs next to the nav item, because an
 *  approval queue nobody is told about is a queue that ages. Excludes the viewer's own requests: they cannot act on
 *  those, so counting them would send them to a page where there is nothing to do. */
export function pendingForViewer(rows: readonly AdjustmentRow[], viewerUserId: string | null): number {
  return rows.filter((r) => String(r.status ?? '') === 'awaiting_approval'
    && !(viewerUserId && r.requestedBy && viewerUserId === r.requestedBy)).length;
}

// ---------------------------------------------------------------------------
// Collections ladder (ADMIN-1-Q6)
// ---------------------------------------------------------------------------
export const POLICY_CHANNELS = ['email', 'sms', 'whatsapp', 'call', 'in_app'] as const;
export type PolicyChannel = (typeof POLICY_CHANNELS)[number];
const NEEDS_TEMPLATE: ReadonlySet<string> = new Set(['email', 'sms', 'whatsapp']);

export interface LadderStep { dayOffset: number; channel: PolicyChannel; templateCode: string | null; escalate: boolean }

export type LadderError = 'empty' | 'day' | 'channel' | 'duplicate' | 'template' | 'suspendTooEarly' | 'tooMany';
export type LadderResult = { ok: true; value: LadderStep[] } | { ok: false; error: LadderError; at?: number };

/** Validate a ladder exactly as the server does (domain/dunning-policy.ts), and report WHICH ROW failed so the form
 *  can point at it. A form that says only "invalid" for a twenty-row table is a form people give up on. */
export function buildLadder(
  rows: readonly { dayOffset: string; channel: string; templateCode?: string; escalate?: boolean }[],
  suspendAfterDays: number | null,
): LadderResult {
  const live = rows.filter((r) => String(r.dayOffset ?? '').trim() !== '' || String(r.channel ?? '').trim() !== '');
  if (live.length === 0) return { ok: false, error: 'empty' };
  if (live.length > 20) return { ok: false, error: 'tooMany' };

  const seen = new Set<string>();
  const out: LadderStep[] = [];
  for (let i = 0; i < live.length; i += 1) {
    const r = live[i];
    const d = String(r.dayOffset ?? '').trim();
    if (!/^\d{1,3}$/.test(d)) return { ok: false, error: 'day', at: i };
    const dayOffset = Number.parseInt(d, 10);
    if (dayOffset > 365) return { ok: false, error: 'day', at: i };
    if (!(POLICY_CHANNELS as readonly string[]).includes(r.channel)) return { ok: false, error: 'channel', at: i };
    const channel = r.channel as PolicyChannel;
    const key = `${dayOffset}:${channel}`;
    if (seen.has(key)) return { ok: false, error: 'duplicate', at: i };
    seen.add(key);
    const templateCode = (r.templateCode ?? '').trim() || null;
    if (NEEDS_TEMPLATE.has(channel) && !templateCode) return { ok: false, error: 'template', at: i };
    out.push({ dayOffset, channel, templateCode, escalate: r.escalate === true });
  }
  out.sort((a, b) => (a.dayOffset - b.dayOffset) || (a.channel < b.channel ? -1 : 1));

  if (suspendAfterDays !== null && suspendAfterDays <= out[out.length - 1].dayOffset) {
    return { ok: false, error: 'suspendTooEarly' };
  }
  return { ok: true, value: out };
}

/** Parse the suspension threshold. Blank → null, which MEANS "never suspend automatically" and is the safe default —
 *  so a blank field must never be coerced to 0, which would read as "suspend immediately". */
export function parseSuspendAfterDays(raw: string | null | undefined): number | null | 'bad' {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^\d{1,3}$/.test(s)) return 'bad';
  const n = Number.parseInt(s, 10);
  return n >= 1 && n <= 365 ? n : 'bad';
}

/** The rung that applies at a given lateness, and the one after it — mirrors the server helpers so the queue can show
 *  what the POLICY expects beside what was actually done. */
export function stepForDaysLate(steps: readonly LadderStep[], daysLate: number): LadderStep | null {
  let match: LadderStep | null = null;
  for (const s of steps) if (daysLate >= s.dayOffset) match = s;
  return match;
}
export function nextStepAfter(steps: readonly LadderStep[], daysLate: number): LadderStep | null {
  for (const s of steps) if (s.dayOffset > daysLate) return s;
  return null;
}

/** True when the recorded touches are BEHIND what the policy expects by this point — the one genuinely useful thing
 *  a policy buys the queue: not "what should I do", but "who has been forgotten". */
export function behindPolicy(steps: readonly LadderStep[], daysLate: number, touchesRecorded: number): boolean {
  const due = steps.filter((s) => daysLate >= s.dayOffset).length;
  return due > touchesRecorded;
}
