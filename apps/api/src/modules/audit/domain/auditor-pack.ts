// modules/audit/domain/auditor-pack.ts · PC-56 TENANT-9c · W437's sections as CSV rows (pure). One section per file
// (`auditor-exports.ts` says why). Long format — section · item · value · unit · basis — so every figure carries the words
// that say what it is computed from; money in minor units with the cooperative's own currency code (never `'INR'`).
import type { GstSection, PrivacySection, SchemeSection } from '../read-models/auditor-compliance.read-model';
import type { PackSection } from './auditor-exports';

export interface LedgerSectionInput {
  zeroSum: { checked: number; foot: number; notFoot: number; incomplete: number };
  accounts: ReadonlyArray<{ accountCode: string; entryCount: number; balance: { equal: boolean; driftMinor: string }; chain: { kind: string }; headMatches: boolean | null }>;
  txns: number;
}

type Row = Array<string | number | null>;

export function packRows(section: 'gst', x: { gst: GstSection; currency: string }): Row[];
export function packRows(section: 'schemes', x: { schemes: SchemeSection; currency: string }): Row[];
export function packRows(section: 'privacy', x: { privacy: PrivacySection; currency: string }): Row[];
export function packRows(section: 'ledger', x: LedgerSectionInput & { currency: string }): Row[];
export function packRows(section: PackSection, x: any): Row[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ccy = `${x.currency} minor`;
  if (section === 'gst') {
    const g: GstSection = x.gst;
    return [
      ['gst', 'invoices_issued', g.invoices, 'count', 'trade_invoices issued in the window (this cooperative)'],
      ['gst', 'taxable_value', g.taxableMinor, ccy, 'Σ taxable_minor'],
      ['gst', 'tax', g.taxMinor, ccy, 'Σ tax_minor'],
      ['gst', 'invoice_total', g.totalMinor, ccy, 'Σ total_minor'],
      ...g.bySupplyType.map((b): Row => ['gst', `tax_${b.supplyType}`, b.taxMinor, ccy, b.supplyType === 'intra' ? 'intra-state: CGST + SGST' : b.supplyType === 'inter' ? 'inter-state: IGST' : 'supply type not recorded']),
      ['gst', 'invoices_with_irn', g.withIrn, 'count', 'no e-invoicing integration writes an IRN'],
      ['gst', 'tax_basis_incomplete', g.taxBasisIncomplete, 'count', 'invoices whose tax basis is not complete'],
      ['gst', 'credit_notes', g.creditNotes, 'count', 'credit_notes issued in the window'],
      ['gst', 'credit_note_total', g.creditNoteTotalMinor, ccy, 'Σ credit_notes.total_minor'],
      ['gst', 'credit_note_tax', g.creditNoteTaxMinor, ccy, 'Σ credit_notes.tax_minor'],
    ];
  }
  if (section === 'schemes') {
    const s: SchemeSection = x.schemes;
    return [['schemes', 'applications', s.applications, 'count', 'scheme_applications created in the window'],
      ...s.byStatus.map((b): Row => ['schemes', `status_${b.status}`, b.n, 'count', 'by current status'])];
  }
  if (section === 'privacy') {
    const p: PrivacySection = x.privacy;
    return [['privacy', 'members', p.members, 'count', 'distinct active members of this cooperative'],
      ...p.consents.flatMap((c): Row[] => [
        ['privacy', `consent_${c.purposeCode}_granted`, c.granted, 'count', 'latest consent per member: granted'],
        ['privacy', `consent_${c.purposeCode}_withdrawn`, c.withdrawn, 'count', 'latest consent per member: withdrawn'],
        ['privacy', `consent_${c.purposeCode}_never`, c.never, 'count', 'members with no consent row for this purpose'],
      ]),
      ...p.requests.map((r): Row => ['privacy', `dsr_${r.requestType}_${r.status}`, r.n, 'count', 'data-subject requests by members (ADMIN-5 plane)'])];
  }
  const l: LedgerSectionInput = x;
  return [
    ['ledger', 'transactions', l.txns, 'count', 'ledger_transactions of this cooperative in the window'],
    ['ledger', 'zero_sum_foot', l.zeroSum.foot, 'count', 'transactions whose every leg is visible and Σ = 0'],
    ['ledger', 'zero_sum_not_foot', l.zeroSum.notFoot, 'count', 'transactions whose legs are all visible and Σ ≠ 0'],
    ['ledger', 'zero_sum_incomplete', l.zeroSum.incomplete, 'count', 'transactions with a leg not attributed to this cooperative (cannot be footed here)'],
    ...l.accounts.flatMap((a): Row[] => [
      ['ledger', `account_${a.accountCode}_entries`, a.entryCount, 'count', 'entries on this cooperative-owned account'],
      ['ledger', `account_${a.accountCode}_balance_equals_sum`, a.balance.equal ? 'yes' : `no (drift ${a.balance.driftMinor})`, 'check', 'cached balance = Σ of the ledger'],
      ['ledger', `account_${a.accountCode}_chain`, a.chain.kind, 'verdict', 'walked from genesis with the writer\'s own hash (cap 5,000 → incomplete)'],
      ['ledger', `account_${a.accountCode}_head_matches`, a.headMatches === null ? 'not judged' : a.headMatches ? 'yes' : 'no', 'check', 'account head pointer = last entry hash (truncation check)'],
    ]),
    ['ledger', 'platform_account_chains', 'withheld', 'refused', 'shared, striped platform accounts — unverifiable from one cooperative (ADMIN-6)'],
  ];
}
