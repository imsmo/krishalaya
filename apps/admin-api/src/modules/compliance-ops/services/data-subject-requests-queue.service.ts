// apps/admin-api/src/modules/compliance-ops/services/data-subject-requests-queue.service.ts · the DPDP rights queue.
//
// ADMIN-5 CHANGED WHAT `complete` MEANS, AND THAT IS THE POINT OF THE WAVE.
//
// Before: `action: 'complete'` moved the row to `completed` with a free-text resolution. For an ERASURE that recorded a
// discharged statutory obligation — and nothing had erased anything, because `identity.erasure_ready` (emitted by the
// cooling job) has no consumer anywhere in the monorepo. The most reassuring word in the schema had nothing behind it.
//
// Now: completing an erasure requires that EVERY in-scope data class has a recorded action in `dsr_erasure_actions`.
// Today none will, so an erasure CANNOT be completed — which is the correct behaviour and not a bug to route around.
// The refusal names the outstanding classes, so the queue shows the request honestly stuck rather than dishonestly
// closed. When the executor is built it writes those rows and the guard passes on its own, with no change here.
//
// Also new, all from W041/W042 and all previously impossible:
//   • ACKNOWLEDGE. The 72-hour DPDP clock had no timestamp to measure, so "SLA breaches YTD 0" was unmeasured rather
//     than clean. Acknowledging is deliberately NOT gated on the two-person rule — telling somebody you received their
//     request is not a decision, and putting a second signature in front of it would guarantee the 72 hours are missed.
//   • CODED REJECTION GROUNDS, one of the three lawful ones, received verbatim by the data principal.
//   • DPO COUNTERSIGN on beginning an erasure, via the shared two-person rule extracted at its third instance.
// One ACID tx per write; every transition writes an append-only audit_log row IN THE SAME TX (Law 4).
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import { ComplianceRepository, DsrListQuery } from '../repositories/compliance.repository';
import {
  DsrNotFoundError, ErasureNotEvidencedError, ErasureScopeUnavailableError, InvalidDsrInputError,
} from '../domain/compliance-ops.errors';
import {
  computeScope, withCounts, assertErasureCompletable, assertRejectionGround, groundIsFixableByPrincipal,
  acknowledgeSla, resolveSla, summariseSla, type ScopeResult,
} from '../domain/erasure-scope';
import { UpdateDsrDto } from '../dto/compliance-ops.dto';

@Injectable()
export class DataSubjectRequestsQueueService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: ComplianceRepository) {}

  async update(actor: AdminRequestContext, id: string, dto: UpdateDsrDto) {
    return this.pool.withTx(async (client) => {
      const dsr = await this.repo.getDsrForUpdate(client, id);
      if (!dsr) throw new DsrNotFoundError(id);
      const before = dsr.status;

      let ground: string | null = null;
      let evidenced: number | null = null;

      if (dto.action === 'start') {
        // BEGINNING AN ERASURE IS THE CHECKER STEP (W042: "Beginning erasure needs compliance.dsr + DPO countersign").
        // The initiator is whoever last touched the request — for an app-filed request that is nobody, and the shared
        // rule lets an unknown initiator through rather than creating a permanent dead end. `ck_dsr_countersign_ne_actor`
        // refuses the same row at the database.
        if (dsr.requestType === 'erasure') {
          assertSecondPerson('beginning an erasure', dsr.updatedBy, actor.userId,
            'the operator who last worked this request cannot also countersign it.');
        }
        dsr.startProgress();
        if (dsr.requestType === 'erasure') dsr.countersign(actor.userId, new Date());
      } else if (dto.action === 'complete') {
        if (dsr.requestType === 'erasure') {
          // THE GUARD. Scope from the live policies, evidence from the append-only ledger, both inside this tx.
          const scope = computeScope(await this.repo.retentionPoliciesForScope());
          if (scope.kind !== 'scope') throw new ErasureScopeUnavailableError();
          const recorded = await this.repo.erasureActionsForUpdate(client, id);
          const check = assertErasureCompletable(scope, recorded);
          if (!check.ok) {
            if (check.reason === 'no_scope') throw new ErasureScopeUnavailableError();
            throw new ErasureNotEvidencedError(check.missing, check.classesInScope);
          }
          evidenced = check.classesEvidenced;
        }
        dsr.complete(dto.resolution);            // still throws ErasureCoolingActiveError if the window is open
      } else {
        // REJECT. The ground is mandatory and coded; 0107's CHECK ties status and ground together so an ungrounded
        // rejection cannot be stored even by a future caller that skips this.
        ground = assertRejectionGround(dto.rejectionGround);
        dsr.reject(dto.resolution, ground);
      }

      if (dto.exportMediaId) dsr.attachExportMedia(dto.exportMediaId);
      await this.repo.updateDsr(client, dsr, actor.userId);
      // The countersign is a second statement by design — see the repository comment.
      if (dto.action === 'start' && dsr.requestType === 'erasure') await this.repo.countersignDsr(client, id, actor.userId);

      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: `dpdp.dsr_${dsr.status}`, entityType: 'data_subject_request', entityId: id,
        oldValue: { status: before },
        newValue: {
          status: dsr.status, requestType: dsr.requestType,
          ...(ground ? { rejectionGround: ground, fixableByPrincipal: groundIsFixableByPrincipal(ground as never) } : {}),
          ...(evidenced !== null ? { dataClassesEvidenced: evidenced } : {}),
          ...(dto.action === 'start' && dsr.requestType === 'erasure' ? { countersignedBy: actor.userId } : {}),
        },
        reason: dto.resolution, ip: actor.ip, requestId: actor.requestId || null,
      });
      return dsr.toJSON();
    });
  }

  /** Stamp the DPDP acknowledgement (the 72-hour clock).
   *
   *  NOT two-person gated and NOT elevated: acknowledging receipt is not a decision about anybody's data, and a second
   *  signature in front of it would guarantee the 72 hours are missed. It is audited like everything else.
   */
  async acknowledge(actor: AdminRequestContext, id: string, note: string | null) {
    return this.pool.withTx(async (client) => {
      const dsr = await this.repo.getDsrForUpdate(client, id);
      if (!dsr) throw new DsrNotFoundError(id);
      const now = new Date();
      dsr.acknowledge(now);                     // throws DsrAlreadyAcknowledgedError rather than moving the timestamp
      await this.repo.updateDsr(client, dsr, actor.userId);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.dsr_acknowledged', entityType: 'data_subject_request', entityId: id,
        oldValue: { acknowledgedAt: null }, newValue: { acknowledgedAt: now.toISOString() },
        reason: note ?? 'acknowledged to the data principal', ip: actor.ip, requestId: actor.requestId || null,
      });
      return dsr.toJSON();
    });
  }

  /** Record what was actually done to one data class. The interim path until the executor exists — an operator who
   *  hand-runs a deletion records it here, and only then can the erasure be completed.
   *
   *  DELIBERATELY NOT A BULK "mark everything done" ACTION. One class at a time, each with its own row count and its own
   *  note, because the whole value of the evidence table is that it cannot be satisfied with a single gesture. */
  async recordErasureAction(actor: AdminRequestContext, id: string, v: { dataClass: string; action: string; rowsAffected: number; note: string | null }) {
    return this.pool.withTx(async (client) => {
      const dsr = await this.repo.getDsrForUpdate(client, id);
      if (!dsr) throw new DsrNotFoundError(id);
      if (dsr.requestType !== 'erasure') throw new InvalidDsrInputError('erasure actions may only be recorded against an erasure request');

      // The class must be IN SCOPE. Recording an action for a class no policy covers would let the guard be satisfied
      // by rows that mean nothing — and it is also how a typo silently passes the check for ever.
      const scope = computeScope(await this.repo.retentionPoliciesForScope());
      if (scope.kind !== 'scope') throw new ErasureScopeUnavailableError();
      const line = scope.lines.find((l) => l.dataClass === v.dataClass);
      if (!line) throw new InvalidDsrInputError(`'${v.dataClass}' is not a data class in this erasure's scope`);

      // A class the law forbids deleting may ONLY be recorded as blocked_by_law. Anything else would be a record of an
      // unlawful deletion, and the record would be the only evidence of it.
      if (line.keptByLaw && v.action !== 'blocked_by_law') {
        throw new InvalidDsrInputError(
          `'${v.dataClass}' is retained by law (${line.legalBasis ?? 'legal basis recorded in the retention policy'}) — `
          + "it may only be recorded as 'blocked_by_law'");
      }
      if (!line.keptByLaw && v.action === 'blocked_by_law') {
        throw new InvalidDsrInputError(`'${v.dataClass}' is not retained by law, so it cannot be recorded as blocked_by_law`);
      }

      await this.repo.insertErasureAction(client, {
        requestId: id, dataClass: v.dataClass, action: v.action, rowsAffected: v.rowsAffected,
        // Snapshotted, not joined at read time: a policy edited two years from now must not rewrite the reason a
        // farmer was given.
        legalBasis: line.legalBasis, executedBy: actor.userId, note: v.note,
      });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'dpdp.erasure_action_recorded', entityType: 'data_subject_request', entityId: id,
        newValue: { dataClass: v.dataClass, action: v.action, rowsAffected: v.rowsAffected },
        reason: v.note ?? `${v.action} ${v.dataClass}`, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { requestId: id, dataClass: v.dataClass, action: v.action, rowsAffected: v.rowsAffected };
    });
  }

  /** W042's detail: the request, its scope preview, its evidence, and its SLA clocks. */
  async get(id: string, now = new Date()) {
    const dsr = await this.repo.getDsr(id);
    if (!dsr) throw new DsrNotFoundError(id);
    const json = dsr.toJSON();

    let scope: ScopeResult = { kind: 'no_policy' };
    let actions: Awaited<ReturnType<ComplianceRepository['erasureActions']>> = [];
    if (json.requestType === 'erasure') {
      scope = computeScope(await this.repo.retentionPoliciesForScope());
      actions = await this.repo.erasureActions(id);
      // Counts are NOT fetched. Counting a farmer's rows across every table in scope is a per-request fan-out over
      // ~13 tables that would run on every page view, and `withCounts` leaves them null so the screen says "not
      // counted" rather than 0. Wired here so the shape is ready when a bounded counting path exists.
      scope = withCounts(scope, {});
    }

    const completable = json.requestType === 'erasure'
      ? assertErasureCompletable(scope, actions.map((a) => ({ dataClass: a.dataClass, action: a.action })))
      : null;

    return {
      ...json,
      scope,
      erasureActions: actions,
      completable,
      acknowledgeSla: acknowledgeSla(json.createdAt ?? null, json.acknowledgedAt ?? null, now),
      resolveSla: resolveSla(json.createdAt ?? null, null, json.coolingEndsAt ?? null, now),
      // Said in the payload rather than left to the console: nothing consumes the erasure-ready event, so no automatic
      // execution has happened or will happen for this request.
      automaticExecution: { available: false as const, reason: 'no_consumer_for_erasure_ready_event' as const },
    };
  }

  async list(q: DsrListQuery) {
    const rows = await this.repo.listDsr(q);
    const items = rows.map((d) => d.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last
      ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  /** W041's tiles, from clocks that can actually be read.
   *
   *  `unmeasured` is reported ALONGSIDE `breached`, because before 0107 every request was unmeasurable and a zero
   *  breach count over unmeasurable requests is not a clean record — it is the absence of a measurement, which is what
   *  a regulator would find first.
   */
  async slaSummary(sinceIso: string, now = new Date()) {
    const rows = await this.repo.dsrSlaRows(sinceIso);
    const ack = summariseSla(rows.map((r) => acknowledgeSla(r.createdAt, r.acknowledgedAt, now)));
    const res = summariseSla(rows.map((r) => resolveSla(r.createdAt, r.decidedAt, r.coolingEndsAt, now)));
    return {
      since: sinceIso,
      requests: rows.length,
      acknowledge: ack,
      resolve: res,
      openCount: rows.filter((r) => r.status === 'open').length,
      inCoolingCount: rows.filter((r) => r.requestType === 'erasure' && r.status === 'open' && r.coolingEndsAt && r.coolingEndsAt > now).length,
    };
  }
}
