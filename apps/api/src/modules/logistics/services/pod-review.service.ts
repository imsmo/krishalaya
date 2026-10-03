// modules/logistics/services/pod-review.service.ts · PC-56 TENANT-SW-a · D1 — POD REVIEW (canon W237 / W238; founder decision "escrow
// holds only on a flagged POD").
//
// Before: a proof of delivery (OTP + pod_media_id) gated nothing — escrow settled on completion whatever the photo showed — and nobody
// reviewed it. Behind `pod_review` (default OFF), now every delivered shipment gets a review row in the delivery's own transaction:
//   • AWAITING → AUTO_CLEARED on a 2-hour timer (the registered job, per tenant in kv_app's unit of work) unless FLAGGED within it;
//   • FLAGGED (reason from the pod_flag_reason lookup; 'other' needs words; a variance figure optional) → the order's settlement is put
//     ON HOLD (SettlementHoldService, reason pod_review). Only a flagged review holds — an awaiting one does not;
//   • APPROVE → the hold is released → settlement runs in the normal path (the deferred completion, if it already arrived, is settled
//     by payments.settlement_hold_released through the same settle:<order> key);
//   • REJECT is two people: one PROPOSES the rejection, a DIFFERENT one CONFIRMS it (0196 trg_pod_reviews_moves) — which opens a
//     qty_mismatch dispute with the POD photo attached, scoped to the variance when one was entered, else the whole order, and releases
//     the POD hold (the dispute now governs the order's money: it pauses the order);
//   • TAKE NEXT claims the oldest awaiting review (FOR UPDATE SKIP LOCKED).
// Nobody who drove (shipments.rider_user_id) or dispatched (shipments.dispatched_by, written from 0196 on) the shipment may flag,
// review, decide or check it — the trigger is the wall; shipments dispatched before 0196 carry no dispatcher, so for them only the
// driver is checked (named in the report). Weighbridge slips: REFUSED BY NAME — no weighbridge object exists on this platform.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { gateRefusal } from '../../../shared/errors/db-gate';
import { PodFlagReason, PodReviewRepository, PodReviewRow, PodStatus } from '../repositories/pod-review.repository';
import { SettlementHoldService } from '../../payments/services/settlement-hold.service';
import { DisputeService } from '../../disputes/services/dispute.service';
import { OrderService } from '../../orders/services/order.service';
import { LogisticsGateError, PodReviewNotFoundError, PodReviewStateError, PodReviewOffError, ShipmentForbiddenError, InvalidShipmentError } from '../domain/logistics.errors';

export const POD_REVIEW_FLAG = 'pod_review';
export const POD_FLAG_REASONS: readonly PodFlagReason[] = ['mismatch', 'no_photo', 'wrong_recipient', 'weight_variance', 'other'];
export const WEIGHBRIDGE_SLIPS = { recorded: false, why: 'weighbridge slips: not recorded on this platform (no weighbridge object exists)' } as const;
export interface PodActor { userId: string; canManage: boolean }

function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new LogisticsGateError(g.code, g.message);
  throw e;
}

@Injectable()
export class PodReviewService {
  private readonly log = new Logger(PodReviewService.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly flags: FlagsService,
    private readonly audit: AuditWriter,
    private readonly repo: PodReviewRepository,
    private readonly holds: SettlementHoldService,
    private readonly disputes: DisputeService,
    private readonly orders: OrderService,
  ) {}

  private assert(a: PodActor) { if (!a.canManage) throw new ShipmentForbiddenError('POD review requires logistics.manage'); }
  enabled(tenantId: string): Promise<boolean> { return this.flags.isEnabled(POD_REVIEW_FLAG, { tenantId }).catch(() => false); }

  /** Inside the delivery transaction: the review row for this shipment (idempotent). */
  async createOnDeliveryInTx(tx: TxContext, s: { tenantId: string; shipmentId: string; shipmentCreatedAt: Date; orderId: string; riderUserId: string | null;
    dispatchedBy: string | null; podMediaId: string | null; deliveredAt: Date }): Promise<void> {
    await this.repo.insertTx(tx, { id: uuidv7(), tenantId: s.tenantId, shipmentId: s.shipmentId, shipmentCreatedAt: s.shipmentCreatedAt, orderId: s.orderId,
      driverUserId: s.riderUserId, dispatcherUserId: s.dispatchedBy, podMediaId: s.podMediaId, otpVerified: true, deliveredAt: s.deliveredAt });
  }

  async flag(tenantId: string, a: PodActor, key: string, id: string, dto: { reason: PodFlagReason; note?: string; varianceMinor?: string }, ip: string | null) {
    this.assert(a);
    if (!(await this.enabled(tenantId))) throw new PodReviewOffError();
    if (!POD_FLAG_REASONS.includes(dto.reason)) throw new InvalidShipmentError(`unknown POD flag reason: ${dto.reason}`);
    const note = dto.note?.trim() || null;
    if (dto.reason === 'other' && (!note || note.length < 3)) throw new InvalidShipmentError('a POD flagged as "other" needs the reason in words');
    const variance = dto.varianceMinor ? BigInt(dto.varianceMinor) : null;
    return this.act(tenantId, a, key, id, 'flag', async (tx, r) => {
      if (r.status !== 'awaiting') throw new PodReviewStateError(r.status, 'flagged');
      await this.repo.flagTx(tx, tenantId, id, { by: a.userId, reason: dto.reason, note, varianceMinor: variance });
      await this.holds.openInTx(tx, { tenantId, orderId: r.orderId, reason: 'pod_review', sourceId: id, openedBy: a.userId });
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.pod_flagged', entityType: 'pod_review', entityId: id,
        oldValue: { status: 'awaiting' }, newValue: { status: 'flagged', flagReason: dto.reason, varianceMinor: variance?.toString() ?? null, settlementHeld: true }, reason: note ?? dto.reason, ip });
    });
  }

  async approve(tenantId: string, a: PodActor, key: string, id: string, note: string | undefined, ip: string | null) {
    this.assert(a);
    return this.act(tenantId, a, key, id, 'approve', async (tx, r) => {
      if (r.status !== 'flagged') throw new PodReviewStateError(r.status, 'approved');
      await this.repo.approveTx(tx, tenantId, id, a.userId, note?.trim() || null);
      const rel = await this.holds.releaseInTx(tx, { tenantId, orderId: r.orderId, reason: 'pod_review', sourceId: id, releasedBy: a.userId, note: 'POD approved on review' });
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.pod_approved', entityType: 'pod_review', entityId: id,
        oldValue: { status: 'flagged', flagReason: r.flagReason }, newValue: { status: 'approved', holdReleased: rel.released, orderFree: rel.orderFree }, reason: note?.trim() || 'POD approved — escrow may move', ip });
    });
  }

  async proposeReject(tenantId: string, a: PodActor, key: string, id: string, note: string, ip: string | null) {
    this.assert(a);
    const why = (note ?? '').trim();
    if (why.length < 10) throw new InvalidShipmentError('a rejection needs a reason of at least 10 characters');
    return this.act(tenantId, a, key, id, 'propose_reject', async (tx, r) => {
      if (r.status !== 'flagged') throw new PodReviewStateError(r.status, 'rejected');
      if (r.rejectProposedBy) throw new PodReviewStateError('reject-proposed', 'proposed for rejection again');
      await this.repo.proposeRejectTx(tx, tenantId, id, a.userId, why);
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.pod_reject_proposed', entityType: 'pod_review', entityId: id,
        oldValue: { status: 'flagged' }, newValue: { rejectProposedBy: a.userId, needsChecker: true }, reason: why, ip });
    });
  }

  async confirmReject(tenantId: string, a: PodActor, key: string, id: string, ip: string | null) {
    this.assert(a);
    return this.act(tenantId, a, key, id, 'confirm_reject', async (tx, r) => {
      if (r.status !== 'flagged' || !r.rejectProposedBy) throw new PodReviewStateError(r.status, 'rejected without a proposal');
      // NO maker ≠ checker check here on purpose: trg_pod_reviews_moves IS the wall (POD_REJECT_NEEDS_CHECKER).
      const facts = await this.orders.partiesInTx(tx, tenantId, r.orderId);
      const scope = r.varianceMinor ? BigInt(r.varianceMinor) : (facts?.totalMinor ?? 0n);
      const evidence = r.podMediaId ? [r.podMediaId] : [];
      const d = await this.disputes.openFromPodReviewInTx(tx, { tenantId, orderId: r.orderId, podReviewId: id, staffUserId: a.userId, evidenceMediaIds: evidence, scopeMinor: scope,
        description: `POD rejected on review (${r.flagReason}${r.flagNote ? `: ${r.flagNote}` : ''}) — ${r.decisionNote ?? ''}`.trim() });
      await this.repo.confirmRejectTx(tx, tenantId, id, a.userId, d.id);
      await this.holds.releaseInTx(tx, { tenantId, orderId: r.orderId, reason: 'pod_review', sourceId: id, releasedBy: a.userId, note: 'superseded by the dispute opened from this POD review' });
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.pod_rejected', entityType: 'pod_review', entityId: id,
        oldValue: { status: 'flagged', rejectProposedBy: r.rejectProposedBy }, newValue: { status: 'rejected', checker: a.userId, disputeId: d.id, disputedScopeMinor: scope.toString(),
          scopeBasis: r.varianceMinor ? 'variance' : 'whole_order', evidenceMediaIds: evidence, buyerUserId: facts?.buyerUserId ?? null }, reason: r.decisionNote ?? 'POD rejected', ip });
    });
  }

  /** "Take next" — the oldest awaiting review, claimed for the actor (SKIP LOCKED). Returns the review or null when the queue is empty. */
  async takeNext(tenantId: string, a: PodActor) {
    this.assert(a);
    if (!(await this.enabled(tenantId))) throw new PodReviewOffError();
    return this.uow.run(tenantId, async (tx) => {
      let id: string | null = null;
      try { id = await this.repo.claimNextTx(tx, tenantId, a.userId); } catch (e) { rethrowGate(e); }
      if (!id) return null;
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.pod_claimed', entityType: 'pod_review', entityId: id, newValue: { reviewer: a.userId }, reason: 'take next' });
      return this.view((await this.repo.getForUpdate(tx, tenantId, id))!, a.userId);
    }, { userId: a.userId });
  }

  /** The 2-hour clock for one tenant (the job's per-tenant step). */
  async autoClearDue(tenantId: string, limit = 200): Promise<number> {
    return this.uow.run(tenantId, async (tx) => {
      const ids = await this.repo.autoClearDueTx(tx, tenantId, limit);
      for (const id of ids) await this.audit.write(tx, { tenantId, actorUserId: null, action: 'logistics.pod_auto_cleared', entityType: 'pod_review', entityId: id,
        oldValue: { status: 'awaiting' }, newValue: { status: 'auto_cleared' }, reason: 'no flag within the 2-hour review window' });
      return ids.length;
    }, { userId: undefined });
  }

  private act(tenantId: string, a: PodActor, key: string, id: string, op: string, fn: (tx: TxContext, r: PodReviewRow) => Promise<void>) {
    if (!UUID_RE.test(id)) throw new PodReviewNotFoundError(id);
    return this.idem.remember(key, a.userId, `logistics.pod_${op}`, () =>
      this.uow.run(tenantId, async (tx) => {
        const r = await this.repo.getForUpdate(tx, tenantId, id);
        if (!r) throw new PodReviewNotFoundError(id);
        try { await fn(tx, r); } catch (e) { rethrowGate(e); }
        return this.view((await this.repo.getForUpdate(tx, tenantId, id))!, a.userId);
      }, { userId: a.userId }));
  }

  /* ── reads ── */
  async board(tenantId: string, a: PodActor, q: { status?: PodStatus; cursor?: string; limit: number }) {
    this.assert(a);
    const [tiles, rows, enabled] = await Promise.all([this.repo.tiles(tenantId), this.repo.list(tenantId, { status: q.status, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit }), this.enabled(tenantId)]);
    const last = rows[rows.length - 1];
    return { enabled, tiles, items: rows.map((r) => this.view(r, a.userId)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdAt, last.id) : null, weighbridge: WEIGHBRIDGE_SLIPS };
  }
  async get(tenantId: string, a: PodActor, id: string) {
    this.assert(a);
    if (!UUID_RE.test(id)) throw new PodReviewNotFoundError(id);
    const r = await this.repo.get(tenantId, id);
    if (!r) throw new PodReviewNotFoundError(id);
    return { ...this.view(r, a.userId), weighbridge: WEIGHBRIDGE_SLIPS };
  }

  private view(r: PodReviewRow, viewer: string) {
    const involved = viewer === r.driverUserId || viewer === r.dispatcherUserId;
    return { ...r, timerOpen: r.status === 'awaiting' && new Date(r.timerDueAt).getTime() > Date.now(),
      // display only — the trigger re-judges every act
      youDroveOrDispatched: involved,
      canFlag: !involved && r.status === 'awaiting' && new Date(r.timerDueAt).getTime() > Date.now(),
      canApprove: !involved && r.status === 'flagged',
      canProposeReject: !involved && r.status === 'flagged' && !r.rejectProposedBy,
      canConfirmReject: !involved && r.status === 'flagged' && !!r.rejectProposedBy && r.rejectProposedBy !== viewer,
      dispatcherRecorded: r.dispatcherUserId != null };
  }
}

/** The 2-hour auto-clear clock (registered in SCHEDULED_JOB_REGISTRY; every 5 minutes, advisory-locked by the runner). Reads only
 *  `tenants` with the runner's pool, then clears per tenant in kv_app's unit of work (HOTFIX-2 / 11b pattern). */
export class PodAutoClearJob {
  readonly name = 'logistics-pod-auto-clear';
  private readonly log = new Logger(PodAutoClearJob.name);
  constructor(readonly intervalMs: number, private readonly svc: PodReviewService) {}
  async sweep(pool: Pool): Promise<{ tenants: number; cleared: number; failed: number }> {
    const t = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE status IN ('trial','active','grace') AND deleted_at IS NULL ORDER BY id`);
    let cleared = 0, failed = 0;
    for (const { id } of t.rows) {
      try { cleared += await this.svc.autoClearDue(id); }
      catch (e) { failed++; this.log.error(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return { tenants: t.rows.length, cleared, failed };
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.cleared || r.failed) this.log.log(`${this.name}: ${r.cleared} auto-cleared, ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
