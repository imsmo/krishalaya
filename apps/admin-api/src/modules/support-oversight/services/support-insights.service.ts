// apps/admin-api/src/modules/support-oversight/services/support-insights.service.ts · agent performance, CSAT and the
// SLA matrix (PC-56 ADMIN-2, canon W055 / W056 / W054). READ-ONLY; support is money-free.
//
// WHAT THESE NUMBERS ARE AND ARE NOT — stated in the payload as well as here, so a second console cannot re-label them:
//   • AGENT PERFORMANCE is computed from `support_tickets` alone. `handled` counts RESOLVED tickets, because an agent
//     whose queue is full of hard open cases is not a slow agent and counting those would say so. First response is a
//     real p50 from `percentile_cont`, not a mean — one ticket answered after a weekend would drag a mean into fiction.
//     CSAT arrives with its COUNT beside it: a 5.0 from one rating is not the fact a 4.6 from two hundred is.
//   • CSAT has NO VERBATIM COMMENTS. The canon's W056 shows a "Verbatim (translated)" column and `support_tickets`
//     stores a 1–5 score with no comment field (0012). The read returns scores only and SAYS the column is unavailable,
//     rather than rendering an empty one that would read as "nobody wrote anything".
//   • THE SLA MATRIX IS THE REAL ONE. It is not read from a config table because there is no config table: the targets
//     live in code (`domain/sla.ts`, mirroring apps/api). So the matrix is served from that constant — the actual
//     numbers the platform enforces — and the ESCALATION CHAIN the canon also shows (who is paged at breach, +30min,
//     +2h) genuinely does not exist anywhere and is reported as absent.
import { Injectable } from '@nestjs/common';
import { SupportOversightRepository } from '../repositories/support-oversight.repository';
import { SEVERITIES, SLA_MINUTES } from '../domain/sla';
import { QueryInsightsDto, QueryCsatDto } from '../dto/support-oversight.dto';

@Injectable()
export class SupportInsightsService {
  constructor(private readonly repo: SupportOversightRepository) {}

  async agents(q: QueryInsightsDto) {
    const rows = await this.repo.agentPerformance(q.from, q.to, q.limit);
    return {
      window: { from: q.from, to: q.to },
      agents: rows,
      basis: {
        handled: 'tickets_resolved_in_window',
        firstResponseP50Sec: 'median_not_mean',
        csatAvgBps: 'share_of_five_in_basis_points_with_sample_count',
        openTicketsExcluded: 'an agent holding hard open cases is not a slow agent',
      },
    };
  }

  async csat(q: QueryCsatDto) {
    const [scores, distribution] = await Promise.all([
      this.repo.csatScores({ fromIso: q.from, toIso: q.to, maxScore: q.maxScore, limit: q.limit }),
      this.repo.csatDistribution(q.from, q.to),
    ]);
    const rated = distribution.reduce((a, d) => a + d.n, 0);
    const weighted = distribution.reduce((a, d) => a + d.score * d.n, 0);
    return {
      window: { from: q.from, to: q.to },
      distribution,
      ratedCount: rated,
      // NULL, not 0, when nothing was rated: an unrated window is not a window everybody hated
      averageBps: rated > 0 ? Math.round((weighted / rated / 5) * 10000) : null,
      scores,
      verbatimsAvailable: false,
      verbatimsNote: 'support_tickets stores a 1-5 score and no comment field, so no verbatim column is served (GAP-BACKEND ADMIN-2-Q1)',
    };
  }

  /** The SLA matrix the platform actually enforces, plus an honest statement about the escalation chain. */
  slaMatrix() {
    return {
      severities: SEVERITIES.map((severity) => ({
        severity,
        firstResponseMinutes: SLA_MINUTES[severity].firstResponse,
        resolutionMinutes: SLA_MINUTES[severity].resolution,
      })),
      source: 'code_constant',
      sourceNote: 'these targets live in domain/sla.ts (mirroring apps/api support-ticket.entity) and are applied when a ticket is opened; there is no SLA config table, so they cannot be edited from a console',
      escalationChainConfigured: false,
      escalationChainNote: 'the canon W054 chain (who is paged at breach, +30min, +2h) is not stored anywhere yet (GAP-BACKEND ADMIN-2-Q2)',
    };
  }
}
