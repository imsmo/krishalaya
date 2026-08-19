// apps/web-tenant/src/features/logistics/freight.ts · W241/W242 as PURE rules (PC-56 TENANT-5c).
// No React, no I/O — unit- and mutation-tested; the API re-enforces every gate server-side.
//
// W241: *"Freight leakage is quiet money; this desk makes it loud."* Most of this file is about how loud the desk is
// allowed to be — a variance printed against an expected figure nobody recorded is noise, not leakage, and a screen
// that cannot tell the two apart makes the desk useless the first week.

import type {
  FreightExpected, FreightInvoiceRow, FreightLineVerdict, FreightPayment, FreightReconStatus, FreightSourceKind,
} from '@krishalaya/sdk-js';

/* ------------------------------------------------------------------------------------------------------- */
/* THE LIST (W241)                                                                                         */
/* ------------------------------------------------------------------------------------------------------- */

export const FREIGHT_TABS = ['all', 'open', 'disputed', 'closed'] as const;
export type FreightTab = (typeof FREIGHT_TABS)[number];

export function isFreightTab(v: string | undefined): v is FreightTab {
  return !!v && (FREIGHT_TABS as readonly string[]).includes(v);
}
export function tabOf(raw: string | undefined): FreightTab {
  return isFreightTab(raw) ? raw : 'all';
}

/**
 * The API filters on 0070's own six-value vocabulary; the desk's tabs are the four QUESTIONS an operator asks.
 *
 * `open` is deliberately `variance_open` and not `pending`: a bill nobody has reconciled yet and a bill with a real
 * variance are different jobs, and the second is the one that costs money. `pending` shows under `all`, where its
 * "Reconcile" action is the obvious next step.
 */
export function statusParam(tab: FreightTab): FreightReconStatus | undefined {
  switch (tab) {
    case 'open':     return 'variance_open';
    case 'disputed': return 'disputed_lines';
    case 'closed':   return 'reconciled';
    default:         return undefined;
  }
}

export function statusKey(s: FreightReconStatus): string { return `freight.status.${s}`; }

/** W241's Recon column: "+₹2,320 over — 4 lines disputed", "exact match", "(cost centre, not billed)". Three
 *  different sentences, and the third is not about money owed at all. */
export function reconBadgeKey(r: Pick<FreightInvoiceRow, 'sourceKind' | 'reconStatus' | 'varianceDirection' | 'disputedLines'>): string {
  if (r.sourceKind === 'own_fleet_cost_note') return 'freight.recon.costCentre';
  if (r.reconStatus === 'pending') return 'freight.recon.notYet';
  if (r.disputedLines > 0) return 'freight.recon.disputed';
  if (r.reconStatus === 'exact_match') return 'freight.recon.exact';
  if (r.varianceDirection === 'over') return 'freight.recon.over';
  if (r.varianceDirection === 'under') return 'freight.recon.under';
  return 'freight.recon.level';
}

/** An own-fleet cost note has no expected side — W241 prints a dash, and a ₹0 would read as "we expected this to be
 *  free". Also true of a carrier invoice nobody has reconciled yet: its expected column is not zero, it is unknown. */
export function showsExpected(r: Pick<FreightInvoiceRow, 'expectedApplies' | 'reconStatus'>): boolean {
  return r.expectedApplies && r.reconStatus !== 'pending';
}

/** Which action a row offers. A cost note is booked, not reconciled; a closed invoice offers only the read. */
export function rowActionKey(r: Pick<FreightInvoiceRow, 'sourceKind' | 'reconStatus'>): 'reconcile' | 'book' | 'open' | null {
  if (r.sourceKind === 'own_fleet_cost_note') return r.reconStatus === 'pending' ? 'book' : null;
  if (r.reconStatus === 'pending') return 'reconcile';
  if (r.reconStatus === 'reconciled' || r.reconStatus === 'exact_match') return 'open';
  return 'open';
}

/** The variance as a percentage string for display, from basis points — never computed in the template, and null
 *  when the API could not compute it (a zero bill, or a cost note). */
export function variancePctText(bps: number | null): string | null {
  if (bps === null) return null;
  return `${(bps / 100).toFixed(2)}%`;
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE EXPECTED SIDE, AND WHY IT IS USUALLY EMPTY                                                          */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W241's column header is *"Expected (Σ charge_minor)"* — and **nothing on this platform writes
 * `shipments.charge_minor`.** `OrderConfirmedHandler`, which creates virtually every shipment in production, passes
 * no charge at all.
 *
 * So the desk says which of three states it is in. This is the single most important sentence on the screen: without
 * it, a real ₹96,440 carrier bill reconciles against ₹0 and every invoice reads as total leakage — the desk would be
 * loud about the wrong thing, and an operator would learn to ignore it inside a week.
 */
export function expectedKey(e: FreightExpected): string {
  switch (e.kind) {
    case 'priced':        return 'freight.expected.priced';
    case 'partly_priced': return 'freight.expected.partly';
    default:              return 'freight.expected.none';
  }
}

/** True when the variance shown on this invoice cannot be trusted as a leakage figure, because part or all of the
 *  expected side is missing. The screen shows the number AND this caveat, never the number alone. */
export function varianceIsPartial(e: FreightExpected): boolean {
  return e.kind !== 'priced';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE LINES (W242)                                                                                        */
/* ------------------------------------------------------------------------------------------------------- */

/** W242's four-column table is Shipment | Billed | Expected | Why it differs. This is the "why", by verdict. */
export function verdictKey(v: FreightLineVerdict): string {
  switch (v.kind) {
    case 'match':     return 'freight.line.match';
    case 'over':      return 'freight.line.over';
    case 'under':     return 'freight.line.under';
    case 'unmatched': return 'freight.line.unmatched';
    default:          return 'freight.line.unpriced';
  }
}

/** How the row reads. `unmatched` is the loudest thing on this screen — a bill for a consignment we have no record
 *  of shipping — and it is louder than an over-bill, because an over-bill is a price argument and this is a phantom. */
export function verdictTone(v: FreightLineVerdict): 'ok' | 'warn' | 'bad' | 'muted' {
  switch (v.kind) {
    case 'match':     return 'ok';
    case 'over':      return 'warn';
    case 'unmatched': return 'bad';
    case 'under':     return 'muted';
    default:          return 'warn';   // unpriced — not the carrier's fault, and not checkable either
  }
}

/** Whether this line may be disputed at all. A matched line has nothing to argue about; an unpriced one has no
 *  ground to stand on until somebody records what the shipment should have cost — and the console says which. */
export function canDispute(v: FreightLineVerdict, disputeStatus: 'none' | 'disputed' | 'resolved'): boolean {
  if (disputeStatus !== 'none') return false;
  return v.kind === 'over' || v.kind === 'unmatched';
}

export function disputeBlockedKey(v: FreightLineVerdict): string | null {
  if (v.kind === 'match') return 'freight.dispute.nothingToArgue';
  if (v.kind === 'unpriced') return 'freight.dispute.noExpected';
  if (v.kind === 'under') return 'freight.dispute.underBilled';
  return null;
}

/** The coded reason the API classified, as a sentence. `not_evidenced` is the honest one: we can see the variance and
 *  cannot prove its cause, because the rate card and the consignment weight do not exist on this platform. */
export function reasonKey(code: string | null): string | null {
  if (!code) return null;
  const known = ['extra_attempt_billed', 'cancelled_in_transit', 'not_shipped', 'unpriced_line', 'not_evidenced'];
  return known.includes(code) ? `freight.reason.${code}` : 'freight.reason.other';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE MONEY (W241's banner, W242's settlement path)                                                        */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W241: *"Carrier invoices pay from the tenant wallet through the normal rails (maker-checker above ₹25,000) —
 * freight is money like all money."* W242: *"Pay matched lines (₹92,000, checker)"*.
 *
 * The rails cannot carry a carrier. So the button is not drawn, the READY figure is, and the reason is stated: there
 * is no payee row for a `logistics_partners` carrier and no freight payout purpose. A "Pay" button that 500s would be
 * worse than an honest sentence — and a fake success would be worse than both.
 */
export function paymentKey(p: FreightPayment): string {
  switch (p.kind) {
    case 'cost_note_booked':  return 'freight.pay.costNote';
    case 'held_recon_open':   return 'freight.pay.heldReconOpen';
    case 'ready_no_rail':     return 'freight.pay.readyNoRail';
    default:                  return 'freight.pay.nothingClean';
  }
}

/** Never true today, and written as a function so the day the rail exists there is exactly one place to change. */
export function canPay(p: FreightPayment): boolean { void p; return false; }

/** The maker-checker line, when the API read a threshold. `null` means "not read here" — the threshold belongs to the
 *  payments plane — and that is a different sentence from "no checker needed". */
export function checkerKey(p: FreightPayment): string | null {
  if (p.kind !== 'ready_no_rail') return null;
  if (p.needsChecker === null) return 'freight.pay.checkerUnknown';
  return p.needsChecker ? 'freight.pay.checkerNeeded' : 'freight.pay.checkerNotNeeded';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE DOUBLE BILL — the second thing the canon's price comparison cannot see                               */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * The same AWB on two invoices.
 *
 * A phantom line (`unmatched`) is a bill for a consignment we never shipped; this is the opposite shape and just as
 * expensive: a consignment we DID ship, billed correctly, billed twice — usually a carrier's June invoice and its
 * July invoice both carrying the same docket. Every per-line check passes and every invoice's own arithmetic foots.
 * W242 asks "why does this line differ from what we expected", which cannot ask this question at all, because the
 * answer is not on the invoice being reconciled.
 *
 * Shown per line AND as a total, because an operator who sees one duplicate needs to know whether the whole cycle
 * was re-billed.
 */
export function duplicatesFor(duplicates: readonly { awbNo: string }[], awbNo: string | null): number {
  if (!awbNo) return 0;
  return duplicates.filter((d) => d.awbNo === awbNo).length;
}

/** What the duplicate claims are worth, in minor units. BigInt, because a re-billed quarter is a large number of
 *  paise and this figure is the one an operator quotes to the carrier. */
export function duplicateClaimMinor(duplicates: readonly { billedMinor: string }[]): string {
  return duplicates.reduce((a, d) => a + BigInt(d.billedMinor), 0n).toString();
}

export function duplicateKey(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? 'freight.dup.one' : 'freight.dup.many';
}

/** W242's step 2: the dispute pack and its seven-day window — with the platform's honest note that it keeps no such
 *  clock (no deadline column, no carrier SLA, no chaser job). */
export function packKey(clockKept: boolean): string {
  return clockKept ? 'freight.pack.window' : 'freight.pack.windowNotKept';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE FORM (W2612 · W2613 · W2614 · W2615)                                                                */
/* ------------------------------------------------------------------------------------------------------- */

export interface FreightDraft {
  carrierId: string; invoiceNo: string; sourceKind: FreightSourceKind;
  periodStart: string; periodEnd: string; billedMinor: string;
  /** ISO-4217, three letters. **Asked for, not assumed.** `freight_invoices.currency_code` has existed since 0070
   *  and the DTO accepts any three-letter code, so a tenant whose air-freight consolidator bills in USD can record
   *  that bill — but only if the form offers the field. A form that silently stamped every invoice INR would cap
   *  this desk to one country's carriers, which is the plainest kind of Rule Zero violation there is: nothing
   *  errors, the bill is simply recorded in the wrong money. There is no tenant default-currency column anywhere in
   *  this schema (`countries.currency_code` is the closest thing, and a tenant is not a country), so the field
   *  defaults to the platform default below and the gap is named rather than papered over. */
  currencyCode: string;
  /** One line per row of pasted text: `AWB,amount[,attempts]`. A carrier's invoice arrives as a CSV or a PDF table,
   *  and an operator can paste the former. Parsing a PDF is not attempted, and the form says so. */
  linesRaw: string;
}
export type FreightField = 'carrierId' | 'invoiceNo' | 'periodStart' | 'periodEnd' | 'billedMinor' | 'currencyCode' | 'linesRaw';
export type FreightFieldError = { field: FreightField; key: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MINOR_RE = /^\d{1,18}$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;
/** The platform's default, not a rule: it is what the API's own DTO defaults to when a caller omits the field, and
 *  it is pre-selected so an Indian FPO never has to think about currency. Any ISO code the carrier bills in is
 *  accepted, because the column and the DTO both accept one. */
export const DEFAULT_FREIGHT_CURRENCY = 'INR';
export const MAX_FREIGHT_LINES = 5000;

export interface ParsedFreightLine { awbNo: string; billedMinor: string; billedAttempts?: number }

/**
 * Parse the pasted lines. `AWB,amount` per row, with an optional third field for the attempts the carrier claims.
 *
 * Amounts are read as MINOR UNITS to keep one rule end to end (Law 2): a form that accepts "964.40" and multiplies by
 * 100 in the browser has done money arithmetic in a float, and the platform's whole money discipline exists to stop
 * exactly that. The form's own hint says paise, and the review step shows the formatted total so a wrong magnitude is
 * visible before anything is saved.
 */
export function parseLines(raw: string): { lines: ParsedFreightLine[]; errors: number[] } {
  const lines: ParsedFreightLine[] = [];
  const errors: number[] = [];
  const rows = (raw ?? '').split('\n').map((r) => r.trim()).filter((r) => r.length > 0);
  rows.forEach((row, i) => {
    const parts = row.split(',').map((p) => p.trim());
    const [awb, amount, attempts] = parts;
    if (!awb || !amount || !MINOR_RE.test(amount) || parts.length > 3) { errors.push(i + 1); return; }
    if (attempts !== undefined && attempts !== '' && !/^\d{1,2}$/.test(attempts)) { errors.push(i + 1); return; }
    const n = attempts && attempts !== '' ? Number(attempts) : undefined;
    if (n !== undefined && (n < 1 || n > 20)) { errors.push(i + 1); return; }
    lines.push({ awbNo: awb, billedMinor: amount, billedAttempts: n });
  });
  return { lines, errors };
}

/** The sum of the parsed lines, in minor units, as a string. BigInt throughout — a carrier's quarter can exceed
 *  `Number.MAX_SAFE_INTEGER` in paise, and that is not a rounding this platform will make. */
export function linesTotalMinor(lines: readonly ParsedFreightLine[]): string {
  return lines.reduce((a, l) => a + BigInt(l.billedMinor), 0n).toString();
}

/**
 * W2612: *"every invalid field is listed with its reason, values you entered are preserved, nothing was saved."*
 *
 * Every error at once, each naming its own field, and the same rules the server's entity enforces — including the one
 * that matters most: **the lines must sum to the header total.** An upload that lost a line produces a "variance"
 * that is our own transcription error dressed as carrier leakage, and this desk exists to tell the difference.
 */
export function validateDraft(d: FreightDraft): FreightFieldError[] {
  const out: FreightFieldError[] = [];
  if (!d.carrierId) out.push({ field: 'carrierId', key: 'freight.form.err.carrier' });
  const no = d.invoiceNo.trim();
  if (no.length < 3 || no.length > 60) out.push({ field: 'invoiceNo', key: 'freight.form.err.invoiceNo' });
  if (!DAY_RE.test(d.periodStart)) out.push({ field: 'periodStart', key: 'freight.form.err.periodStart' });
  if (!DAY_RE.test(d.periodEnd)) out.push({ field: 'periodEnd', key: 'freight.form.err.periodEnd' });
  if (DAY_RE.test(d.periodStart) && DAY_RE.test(d.periodEnd) && d.periodEnd < d.periodStart) {
    out.push({ field: 'periodEnd', key: 'freight.form.err.periodOrder' });
  }
  if (!MINOR_RE.test(d.billedMinor)) out.push({ field: 'billedMinor', key: 'freight.form.err.billed' });
  if (!CURRENCY_RE.test(d.currencyCode)) out.push({ field: 'currencyCode', key: 'freight.form.err.currency' });
  const parsed = parseLines(d.linesRaw);
  if (parsed.errors.length > 0) out.push({ field: 'linesRaw', key: 'freight.form.err.lineFormat' });
  else if (parsed.lines.length > MAX_FREIGHT_LINES) out.push({ field: 'linesRaw', key: 'freight.form.err.tooManyLines' });
  else if (d.sourceKind === 'carrier_invoice' && parsed.lines.length === 0) {
    // A carrier invoice with no lines cannot be reconciled line by line, which is the only thing this desk does.
    out.push({ field: 'linesRaw', key: 'freight.form.err.noLines' });
  } else if (parsed.lines.length > 0 && MINOR_RE.test(d.billedMinor) && linesTotalMinor(parsed.lines) !== d.billedMinor) {
    out.push({ field: 'billedMinor', key: 'freight.form.err.sumMismatch' });
  }
  return out;
}

export function errorFor(errors: readonly FreightFieldError[], field: FreightField): string | null {
  return errors.find((e) => e.field === field)?.key ?? null;
}

/** W2613's review step: read-only, and it names what will happen NEXT — recording a bill reconciles nothing, and an
 *  operator who thinks the upload checked it will never press Reconcile. */
export function reviewNoticeKey(): string { return 'freight.form.reviewNotice'; }

/** The document upload W241 offers. Accepting a PDF and pretending to read it would be the worst option here: the
 *  media id is attached as EVIDENCE and the lines are keyed or pasted, which the form says out loud. */
export function documentNoticeKey(): string { return 'freight.form.documentNotice'; }

/* ------------------------------------------------------------------------------------------------------- */
/* NAVIGATION AND THE MUTATE CHAIN (W2616 · W2617 · W2618)                                                 */
/* ------------------------------------------------------------------------------------------------------- */

export function deskHref(tab: FreightTab, cursor?: string | null): string {
  const qs = new URLSearchParams();
  if (tab !== 'all') qs.set('tab', tab);
  if (cursor) qs.set('cursor', cursor);
  const s = qs.toString();
  return s ? `/logistics/freight?${s}` : '/logistics/freight';
}
export function reconHref(id: string, act?: 'reconcile' | 'close' | 'dispute' | 'resolve', lineId?: string): string {
  const qs = new URLSearchParams();
  if (act) qs.set('act', act);
  if (lineId) qs.set('line', lineId);
  const s = qs.toString();
  return s ? `/logistics/freight/${encodeURIComponent(id)}?${s}` : `/logistics/freight/${encodeURIComponent(id)}`;
}

export const FREIGHT_ACTIONS = ['reconcile', 'close', 'dispute', 'resolve'] as const;
export type FreightAction = (typeof FREIGHT_ACTIONS)[number];
export function isFreightAction(v: string | undefined): v is FreightAction {
  return !!v && (FREIGHT_ACTIONS as readonly string[]).includes(v);
}
export function actionTitleKey(a: FreightAction): string { return `freight.act.${a}.title`; }

/* ------------------------------------------------------------------------------------------------------- */
/* REFUSALS                                                                                                */
/* ------------------------------------------------------------------------------------------------------- */

export const FREIGHT_REFUSALS: Record<string, string> = {
  FREIGHT_INVOICE_EXISTS: 'duplicate',
  FREIGHT_INVOICE_INVALID: 'invalid',
  FREIGHT_RECON_CLOSED: 'closed',
  PARTNER_NOT_FOUND: 'carrierUnknown',
  SHIPMENT_FORBIDDEN: 'forbidden',
  FORBIDDEN: 'forbidden',
  FREIGHT_INVOICE_NOT_FOUND: 'gone',
  FREIGHT_LINE_NOT_FOUND: 'lineGone',
  validation: 'validation',
  // Refused by the console before the request is made, and named as precisely as the server's own codes are: a
  // dispute with three words in it is not a dispute a carrier can answer, and an "agreed" resolution with no amount
  // would silently accept the billed figure — the opposite of what the operator pressed.
  reasonTooShort: 'reasonTooShort',
  agreedAmount: 'agreedAmount',
};

export function freightErrorKey(code: string): string {
  return `freight.err.${FREIGHT_REFUSALS[code] ?? 'generic'}`;
}

export const FREIGHT_OK = ['recorded', 'reconciled', 'disputed', 'resolved', 'closed', 'booked'] as const;
export function freightOkKey(code: string): string | null {
  return (FREIGHT_OK as readonly string[]).includes(code) ? `freight.ok.${code}` : null;
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE FIVE STATES BOTH SCREENS DECLARE                                                                    */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W241 and W242 each declare five states, and two of them are NOT errors: *"Freight billing restricted — logistics
 * + finance dual scope"* and *"Flagged off — Freight Invoices disabled … Nothing is broken — it is not enabled."*
 *
 * `FeatureFlagGuard` throws **404** on purpose ("invisible when disabled", Law 10), so the flag and a deleted row
 * arrive with the same status — which is why this wave gave `FreightInvoiceNotFoundError` its own code. With that,
 * the two states separate cleanly and neither screen has to guess:
 *   • the LIST cannot be "not found" — the collection always exists for a tenant — so a 404 there is the flag;
 *   • a DETAIL 404 is the flag too, UNLESS it carries `FREIGHT_INVOICE_NOT_FOUND`, which is the row being gone.
 * A 403 is the restricted state either way. Anything else is the load error, whose copy carries W241's promise that
 * nothing pays while the view is down (Law 12: fail closed, degrade, do not die).
 */
export type FreightViewState = 'ok' | 'flaggedOff' | 'restricted' | 'gone' | 'error';

export function deskState(code: string | null | undefined, status?: number): FreightViewState {
  if (!code && status === undefined) return 'ok';
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || status === 404) return 'flaggedOff';
  return 'error';
}

export function detailState(code: string | null | undefined, status?: number): FreightViewState {
  if (!code && status === undefined) return 'ok';
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'FREIGHT_INVOICE_NOT_FOUND' || code === 'FREIGHT_LINE_NOT_FOUND') return 'gone';
  if (code === 'NOT_FOUND' || status === 404) return 'flaggedOff';
  return 'error';
}

export function stateKey(s: FreightViewState): string { return `freight.state.${s}`; }

/** W241's second empty state — "No invoices this cycle" — is a different sentence from "No freight invoices yet",
 *  and only reachable when a cycle was actually asked for. */
export function emptyKey(hasCycle: boolean): string {
  return hasCycle ? 'freight.empty.cycle' : 'freight.empty.none';
}

/* ------------------------------------------------------------------------------------------------------- */
/* W242's FOOTING, AND THE CLAIM ABOUT OUR OWN EVIDENCE                                                    */
/* ------------------------------------------------------------------------------------------------------- */

export interface FootedLine {
  billedMinor: string;
  expectedMinor: string | null;
  disputeStatus: 'none' | 'disputed' | 'resolved';
}

/**
 * W242's footer: *"4 disputed = ₹4,440 billed vs ₹2,120 expected · variance ₹2,320 — exact, recon foots to the
 * rupee ✓"*.
 *
 * That tick is a CHECK, not decoration: it asserts the disputed lines' own arithmetic closes. So it is computed
 * from the rows in BigInt and `foots` is only true when the three figures agree — and `expectedKnown` says how many
 * of the disputed lines had an expected figure at all, because on this platform most have none and a "₹0 expected"
 * footing would print a variance equal to the whole bill and call it exact.
 */
export function disputedFooting(lines: readonly FootedLine[]): {
  lines: number; billedMinor: string; expectedMinor: string; varianceMinor: string;
  expectedKnown: number; foots: boolean;
} {
  const d = lines.filter((l) => l.disputeStatus === 'disputed');
  let billed = 0n; let expected = 0n; let known = 0;
  for (const l of d) {
    billed += BigInt(l.billedMinor);
    if (l.expectedMinor !== null) { expected += BigInt(l.expectedMinor); known += 1; }
  }
  const variance = billed - expected;
  return {
    lines: d.length,
    billedMinor: billed.toString(),
    expectedMinor: expected.toString(),
    varianceMinor: variance.toString(),
    expectedKnown: known,
    foots: known === d.length && billed - expected === variance,
  };
}

/** W242's lead sentence: *"82 lines match to the rupee (₹92,000)"*. Counted, never asserted. */
export function matchedSummary(lines: readonly { verdict: FreightLineVerdict; billedMinor: string }[]): { lines: number; billedMinor: string } {
  const m = lines.filter((l) => l.verdict.kind === 'match');
  return { lines: m.length, billedMinor: m.reduce((a, l) => a + BigInt(l.billedMinor), 0n).toString() };
}

/**
 * W242: *"Every claim cites our shipment_events — timestamped, GPS-tagged, signed-exportable."*
 *
 * Three claims, and they are not equally true, so they are not printed as one sentence:
 *   • timestamped — TRUE. `shipment_events.occurred_at` has existed since 0007 and 5a made the trail readable;
 *   • GPS-tagged — SOMETIMES. `lat`/`lng` are nullable and only written when the reporting client sent them; the
 *     desk says "where recorded" rather than promising a pin on every claim;
 *   • signed-exportable — FALSE. There is no export of a shipment trail on this platform: no signer, no document,
 *     no media row. A dispute pack that told an operator it was "signed-exportable" would send them into a carrier
 *     argument holding a screenshot.
 */
export const EVIDENCE_CLAIMS = ['timestamped', 'gpsWhereRecorded', 'noSignedExport'] as const;
export function evidenceClaimKey(c: (typeof EVIDENCE_CLAIMS)[number]): string { return `freight.evidence.${c}`; }

/** Per-line evidence, as the API recorded it — attempts we counted against attempts they billed, and the named
 *  missing inputs. Rendered from the jsonb rather than re-derived, so the pack shows what was actually stored. */
export function evidenceFacts(e: Record<string, unknown> | null): Array<{ key: string; value: string | null }> {
  if (!e) return [];
  const out: Array<{ key: string; value: string | null }> = [];
  if (typeof e.billedAttempts === 'number' && typeof e.ourAttempts === 'number') {
    out.push({ key: 'freight.evi.attempts', value: `${e.billedAttempts} / ${e.ourAttempts}` });
  }
  if (typeof e.status === 'string') out.push({ key: 'freight.evi.status', value: e.status });
  if (Array.isArray(e.missing) && e.missing.length > 0) {
    out.push({ key: 'freight.evi.missing', value: e.missing.map((m) => String(m)).join(', ') });
  }
  if (typeof e.resolvedOutcome === 'string') out.push({ key: `freight.evi.resolved.${e.resolvedOutcome}`, value: null });
  return out;
}

/**
 * W242's *"Settlement path"* — three numbered steps, of which this platform can do the middle one only.
 *
 * Step 1 ("Matched ₹92,000 pays now") has no rail. Step 3 ("agreed lines pay in the next cycle; withdrawn lines
 * close with a credit note") has neither a next-cycle payment nor a credit note: `resolveLine` records the agreed
 * amount against the line, and that is the whole of it — no document is issued to anybody. Printing the canon's
 * three steps as a description of the software would promise a carrier two payments and a credit note that nothing
 * on this platform will ever produce.
 */
export const SETTLEMENT_STEPS = ['payClean', 'pack', 'nextCycle'] as const;
export type SettlementStep = (typeof SETTLEMENT_STEPS)[number];
export function settlementKey(s: SettlementStep): string { return `freight.settle.${s}`; }
/** Whether the step is something the software does today. Two of three are not. */
export function settlementBuilt(s: SettlementStep): boolean { return s === 'pack'; }
