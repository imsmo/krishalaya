// apps/admin-api/src/modules/trust-safety/services/risk-board.service.ts · W093 + W094 (PC-56 ADMIN-5d).
//
// Two screens, one security object: a named person's risk file. Everything here is gated on `risk.read` rather than
// `moderation.read`, and the split is in owner-roles.ts — a trend line is not a fraud file about somebody.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { TrustSafetyRepository } from '../repositories/trust-safety.repository';
import {
  bandCensus, bandShare, readBand, factorPanel, maskSubject, BAND_EFFECTS, anyEffectEnforced,
  LADDER_IS_ADVISORY, assertBandChange, isRiskBand, RISK_BANDS,
} from '../domain/risk-profile';
import { TrustSubjectNotFoundError } from '../domain/trust-safety.errors';
import type { ChangeBandDto, QueryRiskBoardDto } from '../dto/trust-safety.dto';

/** How many events back the profile explains. W094's panel is an explanation, not an archive; an unbounded read on a
 *  partitioned hot table is how a console query becomes an incident. */
const PROFILE_EVENT_LIMIT = 50;

@Injectable()
export class RiskBoardService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: TrustSafetyRepository,
  ) {}

  /** W093's board. */
  async board() {
    const rows = await this.repo.bandCensusRows();
    const census = bandCensus(rows);
    let activeTotal: number | null = null;
    try { activeTotal = await this.repo.activeUserCount(); } catch { activeTotal = null; }
    return {
      census,
      shares: Object.fromEntries(RISK_BANDS.map((b) => [b, bandShare(census[b], census.total, activeTotal)])),
      scoredTotal: census.total,
      activeTotal,
      ladderAdvisory: LADDER_IS_ADVISORY,
      // W093's cluster board. DELTA-023 is not built, and the honest report is not an empty table — an empty table
      // reads as "no fraud rings found". It reads as "nothing looks".
      clusters: {
        available: false,
        reason: 'no correlation job exists and no clusters table was ever built (DELTA-023) — risk events are not '
          + 'grouped by anything, so this board cannot show a ring even when one is operating',
      },
    };
  }

  async list(q: Omit<QueryRiskBoardDto, 'cursor'> & { cursor?: { s: number; id: string } }) {
    const rows = await this.repo.listByBand({ band: q.band, cursor: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => {
        const reading = readBand(r);
        return {
          userId: r.userId, tenantId: r.tenantId, score: r.score, band: r.band,
          reading, computedAt: r.computedAt, ...maskSubject(r),
        };
      }),
      nextCursor: rows.length > q.limit && last && typeof last.score === 'number'
        ? Buffer.from(`${last.score}|${last.userId}`).toString('base64') : null,
    };
  }

  /** W094's profile. Reading one is an audited event in its own right — opening a named farmer's fraud file is an
   *  act, and the oversight plane established that reads of cross-tenant person data are logged. */
  async profile(actor: AdminRequestContext, userId: string) {
    const r = await this.repo.getProfile(userId);
    if (!r) {
      // W094's own empty state: "New users start at standard (50) — profiles appear after first scored event." The
      // absence is reported as an absence and NOT as a default profile, because rendering "standard · 50" for
      // somebody who has never been scored invents a fact about them.
      throw new TrustSubjectNotFoundError('no risk profile exists for this account — no scored event has been recorded');
    }
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'trust.risk_profile_read', entityType: 'risk_score', entityId: userId,
      reason: 'risk profile opened', ip: actor.ip, requestId: actor.requestId || null,
    });
    const reading = readBand(r);
    const band = isRiskBand(r.band) ? r.band : null;
    let events: Awaited<ReturnType<TrustSafetyRepository['userEvents']>> = [];
    try { events = await this.repo.userEvents(userId, PROFILE_EVENT_LIMIT); } catch { events = []; }
    return {
      userId: r.userId, tenantId: r.tenantId, score: r.score, band: r.band,
      ...maskSubject(r),
      computedAt: r.computedAt,
      reading,
      factors: factorPanel(r.score, r.factors),
      effects: band ? BAND_EFFECTS[band] : [],
      effectsEnforced: band ? anyEffectEnforced(band) : false,
      ladderAdvisory: LADDER_IS_ADVISORY,
      events,
      eventLimit: PROFILE_EVENT_LIMIT,
    };
  }

  /** Change a band by hand. `blocked` requires a second operator (W093/W095); everything else is one operator with a
   *  reason that is sent to the person. */
  async changeBand(actor: AdminRequestContext, userId: string, dto: ChangeBandDto) {
    return this.pool.withTx(async (c) => {
      const r = await this.repo.getProfile(userId);
      if (!r) throw new TrustSubjectNotFoundError('no risk profile exists for this account');
      // The previous actor on this account, from the audit ledger — there is no `band_changed_by` column on
      // `risk_scores` (it has no std columns at all, 0003), so the ledger is the only record of who last acted.
      const prev = await c.query(
        `SELECT actor_user_id FROM audit_log
          WHERE entity_type = 'risk_score' AND entity_id = $1 AND action = 'trust.band_changed'
          ORDER BY created_at DESC LIMIT 1`, [userId]);
      const previousActor: string | null = prev.rows[0]?.actor_user_id ?? null;
      const { to, reason } = assertBandChange({ from: r.band, to: dto.band, reason: dto.reason, actor: actor.userId, previousActor });
      await this.repo.setBand(c, userId, to, actor.userId);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'trust.band_changed', entityType: 'risk_score', entityId: userId,
        oldValue: { band: r.band, score: r.score }, newValue: { band: to },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        ok: true, from: r.band, to,
        // Returned so the console can say it on the success state rather than implying the restriction took effect.
        advisory: LADDER_IS_ADVISORY,
      };
    });
  }
}
