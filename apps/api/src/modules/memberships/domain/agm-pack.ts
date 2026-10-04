// modules/memberships/domain/agm-pack.ts · PC-56 TENANT-SW-d · W199 + W2473–W2477 — THE AGM PACK, AS PURE RULES.
//
// Founder decision (2026-10-04): AN IMMUTABLE PACK FROM FACTS ONLY (F-24). No I/O here. This file decides:
//   • the financial year from the DECLARED basis (`finance.fiscal_year_start_month` → the cooperative's setting, else the country's) —
//     never a compiled-in April;
//   • every section row: a figure set WITH the method that produced it from recorded facts, or a REFUSED row that names why no figure
//     exists. "FPO surplus" and "operating costs" are REFUSED BY NAME (there is no cost ledger); the share of GMV paid to members is
//     printed ONLY as paid ÷ GMV with both facts shown; the auditor annexure is labelled "uploaded by the cooperative — not produced by
//     the platform"; the AGM notice period is refused by name (no bylaw setting exists); quorum is bylaw DATA with its source;
//   • the PDF's lines (the 13d text pdf-writer: WinAnsi Helvetica, no image seam) — the verification QR is REFUSED BY NAME as an image
//     and the verification URL is printed as text, with the CONTENT sha256 (a file cannot carry its own checksum — the file's sha256 is
//     on the verification page); the hi / gu half cannot be drawn by that writer and is REFUSED BY NAME in the PDF (the dataset file
//     and the console carry it);
//   • the canonical content hash.
// 0200's CHECK is the wall under all of it: a refused row may carry NO figure.
import { createHash } from 'node:crypto';

export const AGM_SECTIONS = ['income_expenditure', 'member_statements', 'share_register', 'resolutions', 'auditor_annexure', 'bylaws'] as const;
export type AgmSection = (typeof AGM_SECTIONS)[number];
export const AGM_SECOND_LANGUAGES = ['hi', 'gu'] as const;
export type AgmSecondLanguage = (typeof AGM_SECOND_LANGUAGES)[number];
export const AGM_STATUSES = ['draft', 'proposed', 'issuing', 'issued', 'withdrawn'] as const;
export type AgmStatus = (typeof AGM_STATUSES)[number];

/** The refusal codes a section row can carry (each a console sentence `swd.agm.refusal.<CODE>`). */
export const AGM_REFUSALS = ['NO_COST_LEDGER', 'NO_GMV', 'MIXED_CURRENCY', 'REGISTER_CHANGED_AFTER_FY_END', 'NOT_UPLOADED', 'NO_NOTICE_SETTING'] as const;
export type AgmRefusal = (typeof AGM_REFUSALS)[number];

export interface SectionRow {
  section: AgmSection; item: string; status: 'included' | 'refused'; method: string; refusalCode: AgmRefusal | null;
  figures: Record<string, unknown>; sourceRefs: string[]; sortOrder: number;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE FINANCIAL YEAR                                                                                               */
/* ---------------------------------------------------------------------------------------------------------------- */

export interface FiscalYear { label: string; start: string; endInclusive: string; endExclusive: string; startMonth: number; startYear: number }

const pad = (n: number) => String(n).padStart(2, '0');
/** The FY that STARTS in `startYear` on the 1st of `startMonth`. "FY 2025-26" for a non-January start, "FY 2025" for a calendar year. */
export function fiscalYear(startMonth: number, startYear: number): FiscalYear {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new Error(`fiscalYear: start month ${startMonth}`);
  const start = `${startYear}-${pad(startMonth)}-01`;
  const endExclusive = `${startYear + 1}-${pad(startMonth)}-01`;
  const endD = new Date(`${endExclusive}T00:00:00Z`); endD.setUTCDate(endD.getUTCDate() - 1);
  const endInclusive = endD.toISOString().slice(0, 10);
  const label = startMonth === 1 ? `FY ${startYear}` : `FY ${startYear}-${pad((startYear + 1) % 100)}`;
  return { label, start, endInclusive, endExclusive, startMonth, startYear };
}

/** "FY basis: April start (the cooperative's setting)" — the words of the declared basis. */
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE FACTS THE REPOSITORY READS (shapes only)                                                                     */
/* ---------------------------------------------------------------------------------------------------------------- */

export interface GmvFact { currency: string; orders: number; goodsMinor: string; buyerTotalMinor: string }
export interface MemberCreditFact { currency: string; creditsMinor: string; clawbacksMinor: string; transactions: number }
export interface AccountFact { currency: string; netMinor: string; entries: number }
export interface StatementsFact { statements: number; members: number }
export interface RegisterFact { rowsAtFyEnd: number; holders: number; totalShares: number; paidUpMinor: string; changedAfterFyEnd: number }
export interface ResolutionFact { id: string; title: string; closedAt: string; outcome: string; type: string }
export interface AnnexureFact { mediaId: string; bytes: string | null; sha256: string | null; mime: string }
export interface QuorumFact { quorumBp: number; source: 'tenant_setting' | 'platform_default' }

export interface PackFacts {
  fy: FiscalYear; zone: string; countryCurrency: string | null; memberCount: number;
  gmv: GmvFact[]; memberCredits: MemberCreditFact[];
  platformFees: AccountFact[]; gstPayable: AccountFact[]; tenantCommission: AccountFact[];
  statements: StatementsFact; register: RegisterFact; resolutions: ResolutionFact[]; annexure: AnnexureFact | null; quorum: QuorumFact | null;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* ASSEMBLY — every row a figure WITH its method, or a refusal by name                                              */
/* ---------------------------------------------------------------------------------------------------------------- */

const big = (s: string | number | bigint) => BigInt(String(s));
/** paid ÷ GMV in basis points, floor, integers only (Law 2: no float near money). Null when there is no GMV. */
export function shareBp(paidMinor: string, gmvMinor: string): number | null {
  const g = big(gmvMinor);
  if (g <= 0n) return null;
  const p = big(paidMinor);
  return Number((p * 10000n) / g);
}
export function bpAsPercent(bp: number): string { return `${Math.floor(bp / 100)}.${pad(bp % 100)}%`; }

export function assemble(f: PackFacts): SectionRow[] {
  const rows: SectionRow[] = [];
  const win = `${f.fy.start} to ${f.fy.endInclusive} (${f.zone})`;
  let order = 0;
  const add = (r: Omit<SectionRow, 'sortOrder'>) => rows.push({ ...r, sortOrder: order++ });

  // ── 1 · income & expenditure (FY) ──
  const gmvOne = f.gmv.length === 1 ? f.gmv[0] : null;
  const currency = gmvOne?.currency ?? (f.gmv.length === 0 ? f.countryCurrency : null);
  add({
    section: 'income_expenditure', item: 'gmv', status: 'included', refusalCode: null, sourceRefs: ['orders'],
    figures: f.gmv.length <= 1
      ? { currency, goodsMinor: gmvOne?.goodsMinor ?? '0', orders: gmvOne?.orders ?? 0, buyerTotalMinor: gmvOne?.buyerTotalMinor ?? '0' }
      : { byCurrency: f.gmv.map((g) => ({ ...g })) },
    method: `GMV = the sum of the goods value (order subtotal, before delivery, fees and tax) of every order whose status is "completed" and whose completion time falls in ${win}. An order refunded or cancelled after completion is not counted. Source: orders.`,
  });
  const credits = f.memberCredits.filter((c) => c.currency === currency);
  const paidNet = credits.reduce((a, c) => a + big(c.creditsMinor) + big(c.clawbacksMinor), 0n);
  add({
    section: 'income_expenditure', item: 'paid_to_members', status: 'included', refusalCode: null, sourceRefs: ['ledger_entries', 'ledger_transactions', 'wallet_accounts'],
    figures: {
      currency, netMinor: paidNet.toString(), creditsMinor: credits.reduce((a, c) => a + big(c.creditsMinor), 0n).toString(),
      clawbacksMinor: credits.reduce((a, c) => a + big(c.clawbacksMinor), 0n).toString(), transactions: credits.reduce((a, c) => a + c.transactions, 0), members: f.memberCount,
    },
    method: `Paid to members = the net of the ledger legs posted to members' Main wallets in ${win} under transaction type escrow_release: order settlements (keys settle:<order>) are credits; dispute and return claw-backs (dispute-clawback:, return-clawback:) are debits. A member is a person holding a member role (farmer, dairy farmer, pashupalak, worker, sardar, vyapari, organic store) today. Promotion top-ups, wages and dividends are not counted. Source: the ledger.`,
  });
  const gmvForShare = f.gmv.length === 1 ? f.gmv[0].goodsMinor : '0';
  const bp = f.gmv.length > 1 ? null : shareBp(paidNet.toString(), gmvForShare);
  if (f.gmv.length > 1) {
    add({ section: 'income_expenditure', item: 'paid_share', status: 'refused', refusalCode: 'MIXED_CURRENCY', figures: {}, sourceRefs: [],
      method: 'The share of GMV paid to members is refused: the year\'s orders are in more than one currency, and a ratio across currencies would be invented.' });
  } else if (bp === null) {
    add({ section: 'income_expenditure', item: 'paid_share', status: 'refused', refusalCode: 'NO_GMV', figures: {}, sourceRefs: [],
      method: 'The share of GMV paid to members is refused: there is no GMV in this year to divide by.' });
  } else {
    add({ section: 'income_expenditure', item: 'paid_share', status: 'included', refusalCode: null, sourceRefs: ['gmv', 'paid_to_members'],
      figures: { bp, percent: bpAsPercent(bp), paidMinor: paidNet.toString(), gmvMinor: gmvForShare, currency },
      method: 'Share = Paid to members ÷ GMV, both printed above in the same currency, in basis points rounded down. It is a ratio of two facts, not a measure of what reached any one farmer.' });
  }
  const acct = (item: string, list: AccountFact[], what: string) => {
    const mine = list.filter((x) => x.currency === currency);
    add({ section: 'income_expenditure', item, status: 'included', refusalCode: null, sourceRefs: ['ledger_entries', 'wallet_accounts'],
      figures: { currency, netMinor: mine.reduce((a, x) => a + big(x.netMinor), 0n).toString(), entries: mine.reduce((a, x) => a + x.entries, 0) },
      method: `${what} — the net of the legs posted to that account in ${win} by this cooperative's order settlements and their claw-backs (transaction type escrow_release). Source: the ledger.` });
  };
  acct('platform_fees', f.platformFees, 'Platform fees = the platform Fees account (one leg per settlement: the platform\'s share of commission, plus the platform fee and the delivery fee)');
  acct('gst_on_commission', f.gstPayable, 'GST on commission = the platform GST-payable account');
  acct('tenant_commission', f.tenantCommission, 'Cooperative commission = this cooperative\'s own Commission account');
  add({ section: 'income_expenditure', item: 'surplus', status: 'refused', refusalCode: 'NO_COST_LEDGER', figures: {}, sourceRefs: [],
    method: 'FPO surplus is refused: the platform keeps no ledger of the cooperative\'s operating costs, so a surplus cannot be computed from recorded facts. It belongs in the audited accounts (see the auditor annexure).' });
  add({ section: 'income_expenditure', item: 'operating_costs', status: 'refused', refusalCode: 'NO_COST_LEDGER', figures: {}, sourceRefs: [],
    method: 'Operating costs are refused: no cost ledger exists on the platform. The cooperative\'s own books (and its auditor) are the source.' });

  // ── 2 · member statements ──
  add({ section: 'member_statements', item: 'statements', status: 'included', refusalCode: null, sourceRefs: ['settlement_statements'],
    figures: { statements: f.statements.statements, members: f.statements.members, link: '/settlements/statements' },
    method: `Settlement statements whose period overlaps ${f.fy.start} to ${f.fy.endInclusive}, issued to members (as defined above). Every member reads their own statement in their language on the statements page.` });

  // ── 3 · share register as of FY end ──
  if (f.register.changedAfterFyEnd > 0) {
    add({ section: 'share_register', item: 'snapshot', status: 'refused', refusalCode: 'REGISTER_CHANGED_AFTER_FY_END', figures: {}, sourceRefs: ['coop_share_registers'],
      method: `The register as of ${f.fy.endInclusive} is refused: ${f.register.changedAfterFyEnd} register row(s) that existed then were changed afterwards, and the register keeps no history to rebuild the year-end values from.` });
  } else {
    add({ section: 'share_register', item: 'snapshot', status: 'included', refusalCode: null, sourceRefs: ['coop_share_registers'],
      figures: { holders: f.register.holders, totalShares: f.register.totalShares, paidUpMinor: f.register.paidUpMinor, currency: f.countryCurrency, rows: f.register.rowsAtFyEnd },
      method: `The share register as of ${f.fy.endInclusive}: rows created before the year ended and not removed by then; none of them has changed since, so these are the year-end values. A holder holds more than zero shares; paid-up capital is the recorded share value of those holdings.` });
  }

  // ── 4 · resolutions closed in the FY ──
  const passed = f.resolutions.filter((r) => r.outcome === 'passed').length;
  const failed = f.resolutions.filter((r) => r.outcome === 'failed').length;
  add({ section: 'resolutions', item: 'closed_in_fy', status: 'included', refusalCode: null, sourceRefs: ['coop_resolutions', 'coop_votes'],
    figures: { count: f.resolutions.length, passed, failed, notRecorded: f.resolutions.length - passed - failed,
      items: f.resolutions.slice(0, 100).map((r) => ({ title: r.title, closedAt: r.closedAt, outcome: r.outcome, type: r.type })) },
    method: `Resolutions closed in ${win}, with the outcome recorded at close (quorum and majority snapshotted then). A resolution closed before results were recorded reads "not recorded".` });

  // ── 5 · auditor annexure ──
  if (f.annexure) {
    add({ section: 'auditor_annexure', item: 'annexure', status: 'included', refusalCode: null, sourceRefs: ['media_assets'],
      figures: { mediaId: f.annexure.mediaId, bytes: f.annexure.bytes, sha256: f.annexure.sha256, mime: f.annexure.mime, label: 'uploaded by the cooperative — not produced by the platform' },
      method: 'The auditor\'s report as UPLOADED BY THE COOPERATIVE — not produced or checked by the platform. Its file is attached to the pack as uploaded.' });
  } else {
    add({ section: 'auditor_annexure', item: 'annexure', status: 'refused', refusalCode: 'NOT_UPLOADED', figures: {}, sourceRefs: [],
      method: 'No auditor annexure was uploaded for this pack. The platform does not produce an audit report; the cooperative attaches its auditor\'s.' });
  }

  // ── 6 · bylaws as DATA ──
  if (f.quorum) {
    add({ section: 'bylaws', item: 'quorum', status: 'included', refusalCode: null, sourceRefs: [f.quorum.source === 'tenant_setting' ? 'tenant_settings:governance.quorum_bp' : 'setting_definitions:governance.quorum_bp'],
      figures: { quorumBp: f.quorum.quorumBp, percent: bpAsPercent(f.quorum.quorumBp), source: f.quorum.source, settingKey: 'governance.quorum_bp' },
      method: f.quorum.source === 'tenant_setting'
        ? 'Quorum, as the cooperative\'s own setting governance.quorum_bp records it today (changed only by two administrators).'
        : 'Quorum, as the platform default for governance.quorum_bp — the cooperative has not recorded its own.' });
  }
  add({ section: 'bylaws', item: 'notice_period', status: 'refused', refusalCode: 'NO_NOTICE_SETTING', figures: {}, sourceRefs: [],
    method: 'The AGM notice period is refused: no bylaw setting for the notice period exists on the platform, and a number from memory is not data.' });
  return rows;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE CONTENT HASH AND THE PDF LINES                                                                               */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Canonical JSON: object keys sorted at every depth — the same rows hash the same, whatever order the database returned keys in. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export function contentSha256(meta: { documentId: string; fiscalYearLabel: string; addendumNo: number }, rows: readonly SectionRow[]): string {
  const body = { meta, rows: [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ s: r.section, i: r.item, st: r.status, m: r.method, rc: r.refusalCode, f: r.figures })) };
  return createHash('sha256').update(canonical(body), 'utf8').digest('hex');
}

/** Document id AGM-<SLUG>-<FY>-<n> — 0200's kv_agm_document_id() is the same formula and the trigger refuses anything else. */
export function documentIdFor(slug: string, fyLabel: string, addendumNo: number): string {
  return `AGM-${slug.toUpperCase()}-${fyLabel.replace(' ', '')}-${addendumNo + 1}`;
}

/** minor units → "1,23,456.78"-free grouping the pdf-writer can print (Western grouping, no currency glyph — WinAnsi). */
export function money(minor: string | null | undefined, currency: string | null): string {
  const neg = String(minor ?? '0').startsWith('-');
  const digits = String(minor ?? '0').replace('-', '').padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency ?? ''} ${neg ? '-' : ''}${whole}.${digits.slice(-2)}`.trim();
}

/** Wrap a sentence for the 595-pt page (Helvetica 11 pt ≈ 95 characters). */
export function wrap(text: string, width = 92, indent = ''): string[] {
  const out: string[] = []; let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) { if (line) out.push(indent + line); line = word; }
    else line = (line ? `${line} ${word}` : word);
  }
  if (line) out.push(indent + line);
  return out;
}

const SECTION_TITLES: Record<AgmSection, string> = {
  income_expenditure: '1. Income and expenditure (financial year)', member_statements: '2. Member business statements',
  share_register: '3. Share register extract', resolutions: '4. Resolutions and results', auditor_annexure: '5. Auditor annexure', bylaws: '6. Bylaws as data',
};
const ITEM_TITLES: Record<string, string> = {
  gmv: 'GMV', paid_to_members: 'Paid to members', paid_share: 'Share of GMV paid to members', platform_fees: 'Platform fees', gst_on_commission: 'GST on commission',
  tenant_commission: 'Cooperative commission', surplus: 'FPO surplus', operating_costs: 'Operating costs', statements: 'Statements', snapshot: 'Register at year end',
  closed_in_fy: 'Resolutions closed', annexure: 'Auditor annexure', quorum: 'Quorum', notice_period: 'AGM notice period',
};
const LANG_NAMES: Record<AgmSecondLanguage, string> = { hi: 'Hindi', gu: 'Gujarati' };

export function figureLine(r: SectionRow): string {
  const f = r.figures as Record<string, any>;
  switch (r.item) {
    case 'gmv': return f.byCurrency ? (f.byCurrency as GmvFact[]).map((g) => `${money(g.goodsMinor, g.currency)} (${g.orders} orders)`).join('; ') : `${money(f.goodsMinor, f.currency)} from ${f.orders} completed orders`;
    case 'paid_to_members': return `${money(f.netMinor, f.currency)} net (credits ${money(f.creditsMinor, f.currency)}, claw-backs ${money(f.clawbacksMinor, f.currency)})`;
    case 'paid_share': return `${f.percent} (${money(f.paidMinor, f.currency)} of ${money(f.gmvMinor, f.currency)})`;
    case 'platform_fees': case 'gst_on_commission': case 'tenant_commission': return money(f.netMinor, f.currency);
    case 'statements': return `${f.statements} statement(s) to ${f.members} member(s)`;
    case 'snapshot': return `${f.holders} holder(s), ${f.totalShares} share(s), paid-up ${money(f.paidUpMinor, f.currency)}`;
    case 'closed_in_fy': return `${f.count} closed: ${f.passed} passed, ${f.failed} failed, ${f.notRecorded} not recorded`;
    case 'annexure': return `${f.mime}, ${f.bytes ?? 'size not recorded'} bytes${f.sha256 ? `, sha256 ${f.sha256}` : ''} - ${f.label}`;
    case 'quorum': return `${f.percent} (${f.source === 'tenant_setting' ? "the cooperative's setting" : 'platform default'})`;
    default: return canonical(f);
  }
}

export interface PdfMeta {
  organisation: string; legalName: string; documentId: string; fy: FiscalYear; zone: string; fyBasisSource: 'tenant_setting' | 'country_default';
  issuedAt: string; addendumNo: number; parentDocumentId: string | null; reason: string | null; verifyUrl: string; contentSha256: string;
  secondLanguage: AgmSecondLanguage;
}

/** The PDF's lines, top to bottom. English (the writer is WinAnsi); every refusal and every method printed. */
export function pdfLines(m: PdfMeta, rows: readonly SectionRow[]): { title: string; lines: string[] } {
  const L: string[] = [];
  L.push(`Organisation: ${m.organisation}${m.legalName && m.legalName !== m.organisation ? ` (${m.legalName})` : ''}`);
  L.push(`Document ID: ${m.documentId}`);
  L.push(`Financial year: ${m.fy.label} - ${m.fy.start} to ${m.fy.endInclusive} (${m.zone})`);
  L.push(`FY basis: ${MONTHS[m.fy.startMonth - 1]} start, ${m.fyBasisSource === 'tenant_setting' ? "from the cooperative's setting finance.fiscal_year_start_month" : "the country's default (the cooperative has not set its own)"}`);
  L.push(`Issued: ${m.issuedAt} - requested by one administrator, confirmed by a second (maker-checker). Immutable once issued.`);
  if (m.addendumNo > 0) {
    L.push(`ADDENDUM ${m.addendumNo} to ${m.parentDocumentId ?? 'the previous pack'} - it replaces that pack; the earlier pack stays on record.`);
    L.push(...wrap(`Reason: ${m.reason ?? ''}`, 92));
  }
  L.push(...wrap(`Verify this pack: ${m.verifyUrl} - shows the issue time, the financial year, the addendum chain and this file's sha256 (a file cannot contain its own checksum).`, 92));
  L.push('Content sha256 (of the figures and methods below):');
  L.push(m.contentSha256);
  L.push('Verification QR: not printed - the platform PDF writer has no image support; use the address above.');
  L.push(...wrap(`${LANG_NAMES[m.secondLanguage]}: this PDF writer cannot draw ${LANG_NAMES[m.secondLanguage]} script (WinAnsi Helvetica, no Indic font). The ${LANG_NAMES[m.secondLanguage]} text of every line is in the pack's dataset file and on the cooperative's console.`, 92));
  L.push('Every figure below is read from recorded facts with its method printed; a figure without a method is refused by name.');
  let last: AgmSection | null = null;
  for (const r of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (r.section !== last) { L.push(''); L.push(SECTION_TITLES[r.section]); last = r.section; }
    const name = ITEM_TITLES[r.item] ?? r.item;
    if (r.status === 'refused') L.push(`REFUSED - ${name} [${r.refusalCode}]`);
    else L.push(`${name}: ${figureLine(r)}`);
    L.push(...wrap(`Method: ${r.method}`, 90, '   '));
    if (r.item === 'closed_in_fy') for (const it of ((r.figures as any).items ?? []) as Array<{ title: string; closedAt: string; outcome: string }>) L.push(...wrap(`- ${it.closedAt.slice(0, 10)} ${it.title} (${it.outcome})`, 88, '   '));
  }
  L.push(''); L.push('This is a computer-generated document assembled by the Krishalaya platform from the cooperative\'s records.');
  // the text writer does not wrap: every line longer than the page is folded here (Helvetica 11 pt ≈ 95 characters per line)
  return { title: `AGM pack - ${m.fy.label} - ${m.documentId}`, lines: L.flatMap((l) => (l.length > 95 ? wrap(l, 92) : [l])) };
}

/** The verification address printed in the PDF: `<console>/verify/agm/<document id>` (the document id names the cooperative). */
export function verifyUrlFor(consoleBaseUrl: string, documentId: string): string {
  const base = (consoleBaseUrl ?? '').replace(/\/+$/, '');
  return `${base}/verify/agm/${encodeURIComponent(documentId)}`;
}
