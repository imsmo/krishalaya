// modules/partner-console/services/partner-dashboard.service.ts · PC-56 PARTNER-1a · founder D1 — THE SIX FIGURES, SERVER-COMPUTED, PARTNER-SCOPED.
//
// `GET /v1/partner/dashboard` (`partner.applications.read`). Each shard is read on the kv_partner axis (the repository's `withAxis`): the
// applications are the ORACLE-ADMITTED ones (this partner's products, a live consent — 0225), the loans and repayments the 0090 partner book.
// Merged here: counts and bigint sums add, the latencies are concatenated raw so the percentiles are exact (partner-dashboard.rules.ts).
//   (1) awaiting decision       — ALL admitted applications in submitted / under_review (a real COUNT, not a page);
//   (2) decided this month      — decision_at in the current calendar month of Asia/Kolkata (the boundary computed by the database from
//                                 now()); approved = amount_approved_minor set (an approval stays an approval after disbursal or a
//                                 cooling-off withdrawal), rejected = status rejected; the approved amount Σ amount_approved_minor;
//   (3) approval rate           — approved ÷ decided in basis points (null when nothing was decided);
//   (4)+(5) portfolio            — Σ outstanding_minor and the count of the partner's loans in active / overdue;
//   (6) on-time share, 90 days  — recorded instalments (loan_repayments rows) whose due_date is in the last 90 IST days: paid_at's IST date
//                                 ≤ due_date ÷ all of them, in basis points (null when none is due). NO repayment schedule exists yet
//                                 (fintech records ad-hoc payments: amount_due = amount_paid), so a missed instalment with no row is not
//                                 counted — the console says so beside the figure;
//   + computedAt (this server's instant); the SLA promise (`financial_partners.sla.decision_hours`) beside the actual median / p90 latency
//     over the last 30 days and how many decisions were within the promise; the FPOs routing to the partner (id + PUBLIC display name only,
//     0204's `public_tenant_profile`; null for a non-live organisation); "needs you today" = the five oldest awaiting applications (id,
//     product, amount, FPO, created) — never an applicant's name, never an `LA-…` number (there is none: ids are uuids).
// ONE partner-realm audit row per read (`partner.dashboard.read`, with the counts) — "application reads are logged" stays true.
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { DashboardShard, PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { DASHBOARD_WINDOWS, percentileNearestRank, rateBps, slaDecisionHours, sumMinor, withinPromise } from '../domain/partner-dashboard.rules';
import { PartnerSession } from '../guards/partner-session.guard';

const actorRole = (s: PartnerSession) => `partner:${s.partnerId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);
const addInt = (xs: readonly string[]) => xs.reduce((a, x) => a + BigInt(x), 0n);

export interface PartnerDashboard {
  computedAt: string;
  applicationsTotal: number;
  awaitingDecision: number;
  decidedThisMonth: { decided: number; approved: number; rejected: number; approvedAmountMinor: string; approvalRateBps: number | null; monthStartsAt: string; timeZone: string };
  portfolio: { outstandingMinor: string; activeLoans: number };
  onTime: { windowDays: number; due: number; onTime: number; shareBps: number | null; basis: 'recorded_instalments' };
  sla: { decisionPromiseHours: number | null; windowDays: number; decided: number; medianSec: number | null; p90Sec: number | null; withinPromise: number | null };
  fpos: Array<{ tenantId: string; name: string | null }>;
  needsYouToday: Array<{ id: string; tenantId: string; fpoName: string | null; productName: string; amountRequestedMinor: string; status: string; createdAt: string }>;
}

@Injectable()
export class PartnerDashboardService {
  constructor(
    private readonly repo: PartnerConsoleRepository,
    private readonly uow: PartnerRealmUnitOfWork,
    private readonly audit: AuditWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async read(s: PartnerSession): Promise<PartnerDashboard> {
    const shards: DashboardShard[] = [];
    for (let i = 0; i < this.repo.shards; i++) shards.push(await this.repo.dashboardShard(i, s.partnerId));
    const computedAt = new Date().toISOString();
    const pick = (k: keyof DashboardShard) => shards.map((x) => x[k] as string);

    const approved = addInt(pick('approved')); const rejected = addInt(pick('rejected')); const decided = approved + rejected;
    const due = addInt(pick('due')); const onTime = addInt(pick('onTime'));
    const latencies = shards.flatMap((x) => x.latenciesSec);
    const org = await this.uow.run(s.partnerId, (tx) => this.repo.partnerOrgTx(tx, s.partnerId), { userId: s.userId });
    const promise = slaDecisionHours(org?.sla);
    const tenantIds = [...new Set(shards.flatMap((x) => x.tenantIds))].sort();
    const names = await this.repo.publicTenantNames(tenantIds);
    const oldest = shards.flatMap((x) => x.oldest)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
      .slice(0, DASHBOARD_WINDOWS.needsYouToday);
    const monthStartsAt = await this.monthStart();

    const out: PartnerDashboard = {
      computedAt,
      applicationsTotal: Number(addInt(pick('total'))),
      awaitingDecision: Number(addInt(pick('awaiting'))),
      decidedThisMonth: {
        decided: Number(decided), approved: Number(approved), rejected: Number(rejected),
        approvedAmountMinor: sumMinor(pick('approvedMinor')), approvalRateBps: rateBps(approved, decided),
        monthStartsAt, timeZone: DASHBOARD_WINDOWS.timeZone,
      },
      portfolio: { outstandingMinor: sumMinor(pick('outstandingMinor')), activeLoans: Number(addInt(pick('activeLoans'))) },
      onTime: { windowDays: DASHBOARD_WINDOWS.onTimeDays, due: Number(due), onTime: Number(onTime), shareBps: rateBps(onTime, due), basis: 'recorded_instalments' },
      sla: {
        decisionPromiseHours: promise, windowDays: DASHBOARD_WINDOWS.latencyDays, decided: latencies.length,
        medianSec: percentileNearestRank(latencies, 50), p90Sec: percentileNearestRank(latencies, 90), withinPromise: withinPromise(latencies, promise),
      },
      fpos: tenantIds.map((id) => ({ tenantId: id, name: names.get(id) ?? null })),
      needsYouToday: oldest.map((o) => ({ ...o, fpoName: names.get(o.tenantId) ?? null })),
    };
    await this.uow.run(s.partnerId, (tx) => this.audit.write(tx, {
      tenantId: null, actorUserId: s.userId, actorRole: actorRole(s), action: 'partner.dashboard.read', entityType: 'financial_partner', entityId: s.partnerId,
      newValue: { partnerId: s.partnerId, realm: 'partner', awaiting: out.awaitingDecision, decided: out.decidedThisMonth.decided, fpos: out.fpos.length, listed: out.needsYouToday.length },
      ip: s.ip, requestId: s.requestId,
    }), { userId: s.userId });
    this.metrics.inc('partner_console.dashboard_read', { partner: s.partnerId });
    return out;
  }

  /** The first instant of the current IST calendar month — the same expression the counts use, answered by the database. */
  private async monthStart(): Promise<string> {
    return this.uow.run(null, async (tx) => {
      const r = await tx.query<{ m0: string }>(`SELECT (${DASHBOARD_WINDOWS.monthBoundarySql}) AS m0`);
      return new Date(r.rows[0].m0).toISOString();
    });
  }
}
