// @krishalaya/sdk-js · THE AUDITOR REALM (PC-56 TENANT-9c): W200 overview · W436 ledger drill-down · W437 compliance pack ·
// W201 the auditor's exports · W2498 the enqueue (the realm's ONE act — an auditor session is refused every other non-GET by
// the API's AuditorReadOnlyGuard). Every read is recorded server-side (`audit_read_log`) before it is answered.
//
// Read the verdict words, never a boolean "verified": the overview reports what was checked (zero-sum, balance = Σ, the
// chain of each account the cooperative OWNS) and what cannot be (`sharedChains.verdict = 'unverifiable'` — platform
// accounts are shared and striped, ADMIN-6). Money is bigint minor units as strings.
import { HttpClient } from '../http';
import { ExportJob } from '../types';

export interface AuditorFiscalYear { declared: boolean; label?: string | null; start?: string; end?: string; startMonth?: number; code?: 'FY_NOT_DECLARED' }
export interface AuditorClock { zone: string; currency: string; today: string; fiscalYear: AuditorFiscalYear }
export interface AuditorWindowView { from: string; to: string; days: number; maxDays: number; defaulted: boolean }
export type AuditorHashLink =
  | { kind: 'linked'; genesis: boolean; prevHash: string | null; entryHash: string }
  | { kind: 'hash_mismatch'; prevHash: string | null; entryHash: string }
  | { kind: 'chain_break'; prevHash: string | null; predecessorHash: string | null; entryHash: string }
  | { kind: 'withheld'; reason: 'shared_stripe' | 'member_wallet' | 'other_tenant' };
export interface AuditorLeg {
  n: number; entryId: string; kind: 'tenant_own' | 'platform' | 'member_wallet' | 'other_tenant'; accountCode: string; accountLabel: string;
  side: 'Dr' | 'Cr' | 'zero'; amountMinor: string; runningMinor: string; balanceAfterMinor: string | null; hashLink: AuditorHashLink;
}
export interface AuditorTxnFoot { sumMinor: string; foots: boolean; legsVisible: number; legsTotal: number; complete: boolean; terms: string[] }
export interface AuditorTxn {
  txnId: string; createdAt: string; txnType: string | null; referenceType: string | null; referenceId: string | null;
  description: string | null; currencyCode: string | null; legs: AuditorLeg[]; foot: AuditorTxnFoot;
}
export interface AuditorZeroSum { checked: number; foot: number; notFoot: number; incomplete: number }
export interface AuditorOwnAccount { accountCode: string; entryCount: number; balanceEqualsSum: boolean; driftMinor?: string; chain: 'intact' | 'hash_mismatch' | 'chain_break' | 'incomplete' | 'empty'; chainChecked?: number; headMatches: boolean | null }
export interface AuditorLogged { readId: string; purpose: string }
export interface AuditorOverview {
  clock: AuditorClock; window: AuditorWindowView;
  session: { roles: string[]; auditor: boolean; readOnly: boolean };
  integrity: { zeroSum: AuditorZeroSum; ownAccounts: AuditorOwnAccount[]; sharedChains: { verdict: 'unverifiable'; reason: 'shared_stripe'; legsWithheldOnPage: number }; checkedAt: 'this_read' };
  transactions: { count: number };
  privilegedActions: { total: number; withRole: number; withReason: number } | null;
  latest: AuditorTxn[];
  scope: Array<{ code: 'ledger' | 'trail' | 'kyc' | 'governance' | 'reports'; permission: string; held: boolean }>;
  refusedByName: string[];
  logged: AuditorLogged;
}
export interface AuditorIntegrity { zeroSum: AuditorZeroSum; ownLinks: { checked: number; linked: number; broken: number }; withheld: { sharedStripe: number; memberWallet: number; otherTenant: number } }
export interface AuditorLedgerPage { clock: AuditorClock; window: AuditorWindowView; items: AuditorTxn[]; nextCursor: string | null; integrity: AuditorIntegrity; logged: AuditorLogged }
export interface AuditorCompliancePack {
  clock: AuditorClock; window: AuditorWindowView; quarter: { q: 1 | 2 | 3 | 4; start: string; end: string } | null;
  attestation: { status: 'unsigned'; signable: false; reason: 'no_signing_key' };
  sections: {
    gst: { invoices: number; taxableMinor: string; taxMinor: string; totalMinor: string; bySupplyType: Array<{ supplyType: string; invoices: number; taxMinor: string }>; withIrn: number; taxBasisIncomplete: number; creditNotes: number; creditNoteTotalMinor: string; creditNoteTaxMinor: string };
    schemes: { applications: number; byStatus: Array<{ status: string; n: number }> };
    privacy: { members: number; consents: Array<{ purposeCode: string; granted: number; withdrawn: number; never: number }>; requests: Array<{ requestType: string; status: string; n: number }> };
    ledger: { transactions: number; zeroSum: AuditorZeroSum; ownAccounts: AuditorOwnAccount[]; sharedChains: 'unverifiable' };
  };
  unsignedNote: string; logged: AuditorLogged;
}
export interface AuditorExportsPage { items: ExportJob[]; nextCursor: string | null; zone: string; today: string; fiscalYear: AuditorFiscalYear; unsignedNote: string; logged: AuditorLogged }
export type AuditorDatasetCode = 'audit.trail' | 'ledger.entries' | 'compliance.pack';
export const AUDITOR_DATASET_CODES: readonly AuditorDatasetCode[] = ['audit.trail', 'ledger.entries', 'compliance.pack'];
export type AuditorPackSection = 'gst' | 'ledger' | 'schemes' | 'privacy';
export const AUDITOR_PACK_SECTIONS: readonly AuditorPackSection[] = ['gst', 'ledger', 'schemes', 'privacy'];
export interface AuditorExportInput { datasetCode: AuditorDatasetCode; params: { from: string; to: string; section?: AuditorPackSection } }

export class AuditorResource {
  constructor(private readonly http: HttpClient) {}

  /** W200. Requires `ledger.read` (the auditor). */
  async overview(q: { from?: string; to?: string } = {}, signal?: AbortSignal): Promise<AuditorOverview> {
    return (await this.http.request<AuditorOverview>('GET', 'auditor/overview', { query: { from: q.from, to: q.to }, signal })).data;
  }
  /** W436 — keyset (`cursor`), ≤ 92 days, through the tenant funnel. */
  async ledger(q: { from?: string; to?: string; cursor?: string; txnType?: string; limit?: number } = {}, signal?: AbortSignal): Promise<AuditorLedgerPage> {
    return (await this.http.request<AuditorLedgerPage>('GET', 'auditor/ledger', { query: { from: q.from, to: q.to, cursor: q.cursor, txnType: q.txnType, limit: q.limit }, signal })).data;
  }
  /** W437 — computed on read; the current fiscal quarter by default when the year is declared. */
  async compliancePack(q: { from?: string; to?: string } = {}, signal?: AbortSignal): Promise<AuditorCompliancePack> {
    return (await this.http.request<AuditorCompliancePack>('GET', 'auditor/compliance-pack', { query: { from: q.from, to: q.to }, signal })).data;
  }
  /** W201 — the caller's own jobs for the three auditor datasets. */
  async exports(q: { cursor?: string } = {}, signal?: AbortSignal): Promise<AuditorExportsPage> {
    return (await this.http.request<AuditorExportsPage>('GET', 'auditor/exports', { query: { cursor: q.cursor }, signal })).data;
  }
  /** W2498 — THE REALM'S ONE ACT. The key is the confirm page's (Law 3). */
  async enqueueExport(input: AuditorExportInput, idempotencyKey: string): Promise<ExportJob> {
    return (await this.http.request<ExportJob>('POST', 'auditor/exports', { idempotencyKey, body: input })).data;
  }
}
