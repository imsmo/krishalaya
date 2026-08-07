// apps/admin-api/src/modules/trust-safety/services/trust-overview.service.ts · W089 + W098 (PC-56 ADMIN-5d).
//
// The assembly is trivial. The judgement is in which tiles are allowed to carry a number, and every `UNAVAILABLE.*`
// below is a verified absence rather than a shrug — see domain/trust-overview.ts for the audit of each one.
//
// EVERY READ IS INDIVIDUALLY GUARDED. One failed register must not blank the page (Law 12), and — the part that
// matters more — must not silently contribute a zero to a tile that then reads as good news. `sources` records which
// registers were actually reached, and `allQuiet` refuses to claim a clear desk unless all four were.
import { Injectable } from '@nestjs/common';
import { TrustSafetyRepository } from '../repositories/trust-safety.repository';
import {
  tile, rate, medianHours, reasonBreakdown, slaState, orderAttention, allQuiet, unreadSources,
  UNAVAILABLE, REPORT_SLA_HOURS, APPEAL_SLA_HOURS, type AttentionItem, type SourcesRead,
} from '../domain/trust-overview';
import { bandCensus, bandShare } from '../domain/risk-profile';
import { blockState, reviewDue } from '../domain/blocklist';
import { weightDrift } from '../domain/risk-rules';

const TIME_TO_ACTION_SAMPLE = 500;

async function tryRead<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try { return { ok: true, value: await fn() }; } catch { return { ok: false }; }
}

@Injectable()
export class TrustOverviewService {
  constructor(private readonly repo: TrustSafetyRepository) {}

  /** W089. */
  async overview() {
    const now = new Date();
    const [reports, appeals, blocks, scores, rules] = await Promise.all([
      tryRead(() => this.repo.openReportStats()),
      tryRead(() => this.repo.pendingAppealStats()),
      tryRead(() => this.repo.listBlocks({ limit: 500 })),
      tryRead(() => this.repo.bandCensusRows()),
      tryRead(() => this.repo.listRules()),
    ]);

    const sources: SourcesRead = { reports: reports.ok, appeals: appeals.ok, blocklist: blocks.ok, risk: scores.ok };
    const attention: AttentionItem[] = [];

    const reportSla = reports.ok ? slaState(reports.value.oldestAt, REPORT_SLA_HOURS, now) : { kind: 'unmeasured' as const };
    if (reports.ok && reportSla.kind === 'breached') {
      attention.push({ id: 'reports-sla', severity: 'overdue', messageKey: 'attention.reportsBreached', params: { hours: String(reportSla.overHours) } });
    } else if (reports.ok && reportSla.kind === 'due_soon') {
      attention.push({ id: 'reports-sla', severity: 'due_soon', messageKey: 'attention.reportsDueSoon', params: { hours: String(reportSla.ageHours) } });
    }

    const appealSla = appeals.ok ? slaState(appeals.value.oldestDueAt, APPEAL_SLA_HOURS, now) : { kind: 'unmeasured' as const };
    if (appeals.ok && appeals.value.pending > 0 && appealSla.kind === 'breached') {
      attention.push({ id: 'appeals-sla', severity: 'overdue', messageKey: 'attention.appealsBreached', params: { hours: String(appealSla.overHours) } });
    }

    if (blocks.ok) {
      const due = reviewDue(blocks.value, now);
      if (due.length) attention.push({ id: 'blocks-review', severity: 'due_soon', messageKey: 'attention.blocksReviewDue', params: { n: String(due.length) } });
      // A block nobody countersigned is the sixth maker-checker site's open item, and W096's rule is that blocks come
      // from confirmed clusters — an unsigned one has had exactly one person's judgement applied to it.
      const unsigned = blocks.value.filter((b) => !b.checkedBy && blockState(b, now) === 'active').length;
      if (unsigned) attention.push({ id: 'blocks-unsigned', severity: 'blocking', messageKey: 'attention.blocksUncountersigned', params: { n: String(unsigned) } });
      // A row that satisfied neither an expiry nor a review date — only possible before 0110's CHECK, and exactly
      // the row W096's rule was written about.
      const unbounded = blocks.value.filter((b) => blockState(b, now) === 'unbounded').length;
      if (unbounded) attention.push({ id: 'blocks-unbounded', severity: 'overdue', messageKey: 'attention.blocksUnbounded', params: { n: String(unbounded) } });
    }

    if (rules.ok) {
      const drift = weightDrift(rules.value);
      const mismatched = drift.filter((d) => d.kind === 'weight_mismatch').length;
      if (mismatched) attention.push({ id: 'rules-drift', severity: 'blocking', messageKey: 'attention.ruleWeightDrift', params: { n: String(mismatched) } });
      const orphaned = drift.filter((d) => d.kind === 'no_producer').length;
      if (orphaned) attention.push({ id: 'rules-orphan', severity: 'info', messageKey: 'attention.ruleNoProducer', params: { n: String(orphaned) } });
    }

    const census = scores.ok ? bandCensus(scores.value) : null;
    if (census && census.unrecognised > 0) {
      attention.push({ id: 'band-unrecognised', severity: 'blocking', messageKey: 'attention.unrecognisedBand', params: { n: String(census.unrecognised) } });
    }

    const items = orderAttention(attention);
    return {
      tiles: {
        openReports: tile(reports.ok ? reports.value.open : null, UNAVAILABLE.registerUnread, 'count'),
        // NOT ZERO. There is no listing hold on the platform at all.
        listingsHeld: tile(null, UNAVAILABLE.noHeldState, 'count'),
        appealsPending: tile(appeals.ok ? appeals.value.pending : null, UNAVAILABLE.registerUnread, 'count'),
        blocksActive: tile(blocks.ok ? blocks.value.filter((b) => blockState(b, now) === 'active').length : null, UNAVAILABLE.registerUnread, 'count'),
      },
      sla: { reports: reportSla, appeals: appealSla },
      attention: items,
      allQuiet: allQuiet(items, sources),
      unreadSources: unreadSources(sources),
      sources,
    };
  }

  /** W098. */
  async insights(days: number) {
    const [outcomes, actioned, durations, reasons, scores, activeTotal] = await Promise.all([
      tryRead(() => this.repo.appealOutcomes(days)),
      tryRead(() => this.repo.actionedReportCount(days)),
      tryRead(() => this.repo.timeToActionHours(days, TIME_TO_ACTION_SAMPLE)),
      tryRead(() => this.repo.reportsByReason(days)),
      tryRead(() => this.repo.bandCensusRows()),
      tryRead(() => this.repo.activeUserCount()),
    ]);

    const census = scores.ok ? bandCensus(scores.value) : null;
    const trustedShare = census && activeTotal.ok ? bandShare(census.trusted, census.total, activeTotal.value) : null;

    // "False-action rate = appeals overturned / actions" (W089). Both halves must be readable, and the denominator is
    // ACTIONS rather than decided appeals — an overturn rate over appeals alone flatters a desk that nobody appeals.
    const falseAction = outcomes.ok && actioned.ok ? rate(outcomes.value.overturned, actioned.value) : { pct: null, lowSample: false, denominator: null };
    const overturn = outcomes.ok ? rate(outcomes.value.overturned, outcomes.value.decided) : { pct: null, lowSample: false, denominator: null };
    const median = durations.ok ? medianHours(durations.value) : null;

    return {
      windowDays: days,
      tiles: {
        fraudLossPrevented: tile(null, UNAVAILABLE.noFraudValuation),
        honestUserFriction: tile(null, UNAVAILABLE.noFrictionMeasure, 'pct'),
        appealOverturnRate: tile(overturn.pct, outcomes.ok ? 'no appeal has been decided in this window' : UNAVAILABLE.registerUnread, 'pct'),
        medianTimeToAction: tile(median, durations.ok ? 'no report has been actioned in this window' : UNAVAILABLE.registerUnread, 'hours'),
        falseActionRate: tile(falseAction.pct, outcomes.ok && actioned.ok ? 'no report has been actioned in this window' : UNAVAILABLE.registerUnread, 'pct'),
      },
      lowSample: { appealOverturnRate: overturn.lowSample, falseActionRate: falseAction.lowSample },
      // A median over a bounded sample is not the median. Labelled, because an unlabelled one is a number somebody
      // will quote.
      medianSample: durations.ok ? { n: durations.value.length, capped: durations.value.length >= TIME_TO_ACTION_SAMPLE } : null,
      reasons: reasons.ok ? reasonBreakdown(reasons.value) : null,
      ecosystem: {
        trustedShare: tile(trustedShare?.pct ?? null, activeTotal.ok ? UNAVAILABLE.registerUnread : UNAVAILABLE.noActiveUserCount, 'pct'),
        gmvTouchedByFraud: tile(null, UNAVAILABLE.noGmvFraudMarker, 'pct'),
        reportersWouldReportAgain: tile(null, UNAVAILABLE.noReporterSurvey, 'pct'),
      },
      scoredTotal: census?.total ?? null,
      activeTotal: activeTotal.ok ? activeTotal.value : null,
    };
  }
}
