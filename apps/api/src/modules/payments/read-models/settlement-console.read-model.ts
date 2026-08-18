// modules/payments/read-models/settlement-console.read-model.ts · W147's cycle table and W148's statements
// list (PC-56 TENANT-4c). Read-only, tenant-scoped in every query, replica-served (Law 12).
import { Injectable } from '@nestjs/common';
import { SettlementCycleRepository, type CycleRow } from '../repositories/settlement-cycle.repository';
import {
  deductionBasis, netReconciles, progressOf, statementDayCount, statementPeriodKind,
  type DeductionBasis, type ProgressState, type StatementPeriodKind,
} from '../domain/settlement-cycle';

export interface CycleSellerRow {
  sellerUserId: string; sellerName: string | null; orders: number;
  grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string;
  /** gross − commission − tax = net, CHECKED. A row that does not reconcile is flagged, never rendered as
   *  arithmetic that works: the net is what the seller is actually paid. */
  reconciles: boolean;
}

export interface SettlementOverview {
  cycle: (CycleRow & { progress: ProgressState }) | null;
  recent: Array<CycleRow & { progress: ProgressState }>;
  sellers: CycleSellerRow[];
  sellerCount: number;
  cycleGrossMinor: string;
  /** WHY the commission and tax columns read what they read (W147's own footnote, as data). */
  deductionBasis: DeductionBasis;
  /** True when this tenant's statements are still produced by the nightly previous-day job rather than by
   *  a cycle close — the screen must not present daily documents as fortnightly ones. */
  legacyDailyStatements: number;
  statementCount: number;
}

export interface StatementRow {
  id: string; statementNo: string; sellerUserId: string; sellerName: string | null;
  periodStart: string; periodEnd: string; periodKind: StatementPeriodKind; dayCount: number;
  grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string;
  reconciles: boolean; hasPdf: boolean; createdAt: string;
}

export interface StatementsPage { items: StatementRow[]; nextCursor: string | null; counts: { total: number; cycleBased: number; legacyDaily: number } }

const encodeCursor = (iso: string, id: string) => Buffer.from(`${iso}|${id}`).toString('base64');

@Injectable()
export class SettlementConsoleReadModel {
  constructor(private readonly repo: SettlementCycleRepository) {}

  /** W147 whole. Every read degrades on its own (Law 12): a failed seller list leaves the cycle card standing. */
  async overview(tenantId: string, cycle: (CycleRow & { progress: ProgressState }) | null): Promise<SettlementOverview> {
    const [recent, sellersRes, chargedTo, counts] = await Promise.all([
      this.repo.recent(tenantId, 6),
      cycle ? this.repo.sellersInPeriod(tenantId, { startIso: cycle.periodStart, endIso: cycle.periodEnd }, 200) : Promise.resolve([]),
      this.repo.commissionChargedTo(tenantId),
      this.repo.statementCounts(tenantId),
    ]);
    const sellers: CycleSellerRow[] = sellersRes.map((s) => ({ ...s, reconciles: netReconciles(s) }));
    return {
      cycle,
      recent: recent.map((c) => ({ ...c, progress: progressOf(c) })),
      sellers,
      sellerCount: sellers.length,
      cycleGrossMinor: sellers.reduce((sum, s) => sum + BigInt(s.grossMinor), 0n).toString(),
      deductionBasis: deductionBasis(chargedTo),
      legacyDailyStatements: counts.legacyDaily,
      statementCount: counts.total,
    };
  }

  /** W148's list. Keyset only, and every row says whether its period is a CYCLE or one of the daily
   *  statements the nightly job produced before this wave. */
  async statements(tenantId: string, opts: { cycleId?: string; cursor?: { c: string; id: string }; limit: number }): Promise<StatementsPage> {
    const [rows, counts] = await Promise.all([
      this.repo.listStatements({ tenantId, cycleId: opts.cycleId, cursor: opts.cursor, limit: opts.limit + 1 }),
      this.repo.statementCounts(tenantId),
    ]);
    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id, statementNo: r.statementNo, sellerUserId: r.sellerUserId, sellerName: r.sellerName,
        periodStart: r.periodStart, periodEnd: r.periodEnd,
        periodKind: statementPeriodKind(r), dayCount: statementDayCount(r),
        grossMinor: r.grossMinor, commissionMinor: r.commissionMinor, taxMinor: r.taxMinor, netMinor: r.netMinor,
        reconciles: netReconciles(r),
        hasPdf: !!r.pdfMediaId,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > opts.limit && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
      counts,
    };
  }
}
