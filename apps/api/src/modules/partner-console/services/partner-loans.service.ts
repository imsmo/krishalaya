// modules/partner-console/services/partner-loans.service.ts · PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — FACTS, NEVER A BORROWER
// (founder 4a-2, 2026-10-28).
//
//   list        — `partner.loans.read`: the loans on THIS lender's own book (0231 `partner_loans`), scattered over the shards and merged on
//                 the µs keyset (created_at, id), NEWEST FIRST (a portfolio is read newest-first; the claims queue's oldest-first was about
//                 how long a claim had waited). The status filter is the FIVE statuses the platform can produce; limit ≤ 100. Loan FACTS only
//                 (domain/partner-loans.rules.ts `projectLoan`), the FPO named by its PUBLIC display name, never its tenant id;
//   get         — one of them; another lender's or an absent id → 404 `PARTNER_LOAN_NOT_FOUND` (never "not yours");
//   repayments  — the repayments RECORDED against one owned loan (never the channel). Ownership is proven FIRST by reading the loan, so an
//                 unowned id answers the same 404 as an absent one;
//   counts      — COUNTS and bigint SUMS over the loans OPENED in a window of IST calendar days [from, to) — by default the current FY
//                 (April–March, Asia/Kolkata), the window ANSWERED BY THE DATABASE (`FY_WINDOW_SQL`) — by `loan_kind` code and by status.
//                 No ratio, no percentage, no average, no PAR (founder 4a-5 / 4a-7, survey E9).
// EVERY read writes ONE partner-realm audit row (`partner.loans.read`, counts only — never an amount, never a person): these are farmers'
// debts (the 1a / 2a / 2c / 3a rule — own configuration is not audited, anything that counts or shows a borrower's records is). Nothing here
// disburses, writes off, restructures, or writes a KCC entry: no such route exists (founder 4a-1 / 4a-5; the live spec pins nine absences).
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import {
  FY_WINDOW_SQL, isPartnerLoanStatus, mergeLoanCounts, projectLoan, projectRepayment, validWindow,
  type PartnerLoanCounts, type PartnerLoanView, type PartnerRepaymentView,
} from '../domain/partner-loans.rules';
import { clampPartnerLimit } from '../domain/partner-console.rules';
import { partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

const actorRole = (s: PartnerSession) => `partner:${s.partnerId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);
/** Newest first on the µs keyset — the merge of the shards' pages. */
const newestFirst = (a: { created_us: string; id: string }, b: { created_us: string; id: string }) =>
  (a.created_us < b.created_us ? 1 : a.created_us > b.created_us ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
/** A repayment history is bounded like the definer is: at most 200 rows, 50 by default. */
const clampRepaymentLimit = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(200, Math.floor(n));
};

@Injectable()
export class PartnerLoansService {
  constructor(
    private readonly repo: PartnerConsoleRepository,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly audit: AuditWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /** ONE partner-realm audit row for one read — counts only; never an amount, never a person. */
  private async trail(s: PartnerSession, surface: 'loans' | 'loan' | 'loan_repayments' | 'loans_counts', counts: Record<string, unknown>, entity?: { type: string; id: string }): Promise<void> {
    await this.uow.run(s.partnerId, (tx) => this.audit.write(tx, {
      tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.loans.read',
      entityType: entity?.type ?? 'financial_partner', entityId: entity?.id ?? s.partnerId,
      newValue: { partnerId: s.partnerId, realm: 'partner', surface, ...counts }, ip: s.ip, requestId: s.requestId,
    }), { userId: s.userId });
    this.metrics.inc('partner_console.loans_read', { partner: s.partnerId, surface });
  }

  async list(s: PartnerSession, q: { status?: string; cursor?: string; limit?: number }): Promise<{ items: PartnerLoanView[]; nextCursor: string | null; limit: number; computedAt: string }> {
    const limit = clampPartnerLimit(q.limit);
    const cursor = decodeKeyset(q.cursor, UUID_RE);
    const status = isPartnerLoanStatus(q.status) ? q.status : undefined;
    const per: Array<Array<Record<string, unknown> & { id: string; created_us: string }>> = [];
    for (let i = 0; i < this.repo.shards; i++) per.push(await this.repo.partnerLoansShard(i, s.partnerId, { status, cursor, limit }));
    const rows = per.flat().sort(newestFirst).slice(0, limit);
    const names = await this.repo.publicTenantNames([...new Set(rows.map((r) => String(r.tenant_id)))]);
    const items = rows.map((r) => projectLoan(r, { fpoName: names.get(String(r.tenant_id)) ?? null }));
    const last = rows[rows.length - 1];
    await this.trail(s, 'loans', { listed: items.length, status: status ?? null, page: cursor ? 'next' : 'first' });
    return { items, nextCursor: rows.length === limit && last ? encodeKeyset(last.created_us, last.id) : null, limit, computedAt: new Date().toISOString() };
  }

  async get(s: PartnerSession, id: string): Promise<PartnerLoanView & { computedAt: string }> {
    const row = UUID_RE.test(id) ? await this.repo.partnerLoan(s.partnerId, id) : null;
    await this.trail(s, 'loan', { found: !!row }, UUID_RE.test(id) ? { type: 'loan', id } : undefined);
    if (!row) throw partnerRefused('PARTNER_LOAN_NOT_FOUND');
    const names = await this.repo.publicTenantNames([String(row.tenant_id)]);
    return { ...projectLoan(row, { fpoName: names.get(String(row.tenant_id)) ?? null }), computedAt: new Date().toISOString() };
  }

  /**
   * One loan's repayment history. Ownership is proven by reading the LOAN first, so an unowned or absent loan id
   * answers the same 404 as a missing one — the realm is not an existence oracle. Two reads, ONE audit row: the
   * surface is the repayment history, and auditing the ownership probe separately would double-count one view.
   */
  async repayments(s: PartnerSession, id: string, q: { limit?: number }): Promise<{ items: PartnerRepaymentView[]; limit: number; computedAt: string }> {
    const limit = clampRepaymentLimit(q.limit);
    const loan = UUID_RE.test(id) ? await this.repo.partnerLoan(s.partnerId, id) : null;
    if (!loan) {
      await this.trail(s, 'loan_repayments', { found: false }, UUID_RE.test(id) ? { type: 'loan', id } : undefined);
      throw partnerRefused('PARTNER_LOAN_NOT_FOUND');
    }
    const rows = await this.repo.partnerLoanRepayments(s.partnerId, id, limit);
    const items = rows.map((r) => projectRepayment(r));
    await this.trail(s, 'loan_repayments', { found: true, listed: items.length }, { type: 'loan', id });
    return { items, limit, computedAt: new Date().toISOString() };
  }

  async counts(s: PartnerSession, q: { from?: string; to?: string }): Promise<PartnerLoanCounts> {
    let window: { from: string; to: string };
    if (q.from && q.to) {
      if (!validWindow(q.from, q.to)) throw partnerRefused('PARTNER_LOAN_WINDOW_INVALID');
      window = { from: q.from, to: q.to };
    } else {
      window = await this.currentFy(s);
    }
    const rows: Array<{ kind_code: string | null; status: string; n: string; outstanding_minor: string; principal_minor: string }> = [];
    for (let i = 0; i < this.repo.shards; i++) rows.push(...(await this.repo.partnerLoanCountsShard(i, s.partnerId, window.from, window.to)));
    const out = mergeLoanCounts(rows, window, new Date().toISOString());
    await this.trail(s, 'loans_counts', { from: out.from, to: out.to, loans: out.total });
    return out;
  }

  /** The current FY (April–March, Asia/Kolkata) as IST calendar days — answered by the DATABASE from now(), no application clock. */
  private async currentFy(s: PartnerSession): Promise<{ from: string; to: string }> {
    return this.uow.run(s.partnerId, async (tx) => {
      const r = await tx.query<{ fy_from: string; fy_to: string }>(FY_WINDOW_SQL);
      return { from: String(r.rows[0].fy_from), to: String(r.rows[0].fy_to) };
    }, { userId: s.userId });
  }
}
