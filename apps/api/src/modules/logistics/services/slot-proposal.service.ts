// modules/logistics/services/slot-proposal.service.ts · PC-56 TENANT-SW-e · W230 + W2399–W2401 — the pickup desk.
//
// FOUNDER DECISION: THE DESK PROPOSES, THE MEMBER ACCEPTS. The desk reads every seller's windows and pickup record (masked, 1b),
// reads a SUGGESTION from the seller's own pickup history (no model, no write), and PROPOSES windows with a reason. NOTHING is
// written to the seller's `pickup_slots` until the seller accepts — in the app (their session) or through the OTP link (a code
// sent to their own phone; once it verifies, the decision is written in a unit of work whose `app.user_id` IS the seller).
// 0201's trigger compares `app.user_id` with the seller, so a desk accept is refused by the database, and the pickup_slots owner
// wall refuses a desk session writing a seller's windows directly. Unanswered for 7 days → expired (the clock job).
//
// REFUSED BY NAME: pickup-attempt first-attempt success (only DELIVERY attempts are recorded — delivery first-attempt is printed,
// labelled so) and "members set slots by voice" (no voice capture exists).
import { Inject, Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { encodeKeyset, KeysetCursor } from '../../../shared/pagination/us-keyset';
import { gateRefusal } from '../../../shared/errors/db-gate';
import { NotFoundError } from '../../../shared/errors/app-error';
import { LogisticsOpsRefusedError, ShipmentForbiddenError, SlotProposalNotFoundError } from '../domain/logistics.errors';
import {
  REFUSED_BY_NAME, SLOT_PROPOSAL_DAYS, SUGGESTION_WINDOW_DAYS, SlotDecision, SlotWindow, ratioBps, slotWindowsRefusal, suggestionsFrom,
} from '../domain/logistics-ops';
import { ProposalRow, SlotProposalRepository } from '../repositories/slot-proposal.repository';
import { OpsOtpService } from './ops-otp.service';
import { maskPhone, shortName } from '../../labour/domain/display';

export const SLOT_PROPOSALS_FLAG = 'logistics_slot_proposals';
export interface SlotDeskActor { userId: string; canManage: boolean; ip?: string | null }

function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new LogisticsOpsRefusedError(g.code, g.message, g.code === 'SLOT_PROPOSAL_NOT_SELLER' ? 403 : 409);
  throw e;
}

@Injectable()
export class SlotProposalService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly config: AppConfig,
    private readonly flags: FlagsService,
    private readonly repo: SlotProposalRepository,
    private readonly otp: OpsOtpService,
    private readonly pools: PgPoolProvider,
  ) {}

  private assertManager(a: SlotDeskActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }
  private async assertFlag(tenantId: string) {
    if (!(await this.flags.isEnabled(SLOT_PROPOSALS_FLAG, { tenantId }).catch(() => false))) {
      throw new LogisticsOpsRefusedError('SLOT_PROPOSALS_OFF', 'Slot proposals are not switched on for this organisation', 404);
    }
  }

  /* ─────────────── W230 · the desk's read ─────────────── */
  async desk(tenantId: string, a: SlotDeskActor, q: { cursor?: string; limit: number }) {
    this.assertManager(a);
    const after = q.cursor && /^[0-9a-f-]{36}$/i.test(Buffer.from(q.cursor, 'base64url').toString('utf8')) ? Buffer.from(q.cursor, 'base64url').toString('utf8') : undefined;
    const { rows, total } = await this.repo.deskSellers(tenantId, { afterSellerId: after, limit: q.limit });
    const proposalsOn = await this.flags.isEnabled(SLOT_PROPOSALS_FLAG, { tenantId }).catch(() => false);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({
        sellerUserId: r.sellerUserId, sellerName: shortName(r.fullName), sellerPhoneMasked: r.phone ? maskPhone(r.phone) : null,
        windows: r.windows, pickups30d: r.pickups30d,
        deliveryFirstAttempt: { kind: 'delivery' as const, attempted: r.deliveryAttempted30d, firstAttempt: r.deliveryFirstAttempt30d,
          ratio: ratioBps(r.deliveryFirstAttempt30d, r.deliveryAttempted30d), method: 'delivered at the first delivery attempt ÷ parcels with a delivery attempt, of the parcels picked up in 30 days' },
        pickupFirstAttempt: { kind: 'refused' as const, code: REFUSED_BY_NAME.pickupFirstAttempt },
        openProposal: r.openProposalId ? { id: r.openProposalId, expiresAt: r.openProposalExpiresAt } : null,
      })),
      nextCursor: rows.length === q.limit && last ? Buffer.from(last.sellerUserId, 'utf8').toString('base64url') : null,
      totalSellers: total, proposalsOn,
      refused: { pickupFirstAttempt: REFUSED_BY_NAME.pickupFirstAttempt, voiceSlots: REFUSED_BY_NAME.voiceSlots },
    };
  }

  /** "Run suggestions" — a READ from the seller's own pickup history. No model, no write. */
  async suggestions(tenantId: string, a: SlotDeskActor, sellerUserId: string) {
    this.assertManager(a);
    const facts = await this.repo.pickupFacts(tenantId, sellerUserId, SUGGESTION_WINDOW_DAYS);
    return { sellerUserId, windowDays: SUGGESTION_WINDOW_DAYS, basis: 'own_pickup_history' as const, model: null, writes: 'none' as const,
      label: 'suggestion from your own pickup history', pickupsRead: facts.length, cells: suggestionsFrom(facts) };
  }

  /* ─────────────── W2399 · propose ─────────────── */
  async propose(tenantId: string, a: SlotDeskActor, key: string, dto: { sellerUserId: string; slots: SlotWindow[]; reason: string }) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    const bad = slotWindowsRefusal(dto.slots);
    if (bad) throw new LogisticsOpsRefusedError(bad, 'Each window is a weekday with a start before its end; 1–14 windows, none repeated', 422);
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 10) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A reason of at least 10 characters travels with the proposal', 422);
    return this.idem.remember(key, a.userId, 'logistics.slot_proposal_create', () => this.uow.run(tenantId, async (tx) => {
      const seller = await this.repo.sellerKnown(tx, tenantId, dto.sellerUserId);
      if (!seller) throw new LogisticsOpsRefusedError('SLOT_SELLER_UNKNOWN', 'That member is not an active member of this organisation', 422);
      const id = uuidv7();
      try { await this.repo.insert(tx, { id, tenantId, sellerUserId: dto.sellerUserId, proposedBy: a.userId, slots: dto.slots, reason }); }
      catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.slot_proposal_proposed', entityType: 'pickup_slot_proposal', entityId: id,
        newValue: { sellerUserId: dto.sellerUserId, windows: dto.slots.length, expiresInDays: SLOT_PROPOSAL_DAYS }, reason, ip: a.ip ?? null });
      // the member is told in their language — accept in the app, or through the link (the code is sent to their own phone)
      await this.outbox.write(tx, { tenantId, aggregateType: 'pickup_slot_proposal', aggregateId: id, eventType: 'logistics.slot_proposed',
        payload: { v: 1, proposalId: id, recipientUserIds: [dto.sellerUserId], count: String(dto.slots.length), link: this.linkFor(id) } });
      return { id, status: 'proposed' as const, windows: dto.slots.length };
    }, { userId: a.userId }));
  }

  /* ─────────────── W2400 · withdraw ─────────────── */
  async withdraw(tenantId: string, a: SlotDeskActor, id: string, key: string, reasonRaw: string) {
    this.assertManager(a);
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < 10) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A reason of at least 10 characters is recorded with a withdrawal', 422);
    return this.idem.remember(key, a.userId, 'logistics.slot_proposal_withdraw', () => this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.getForUpdate(tx, tenantId, id);
      if (!p) throw new SlotProposalNotFoundError(id);
      try { await this.repo.withdraw(tx, tenantId, id, a.userId, reason); } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.slot_proposal_withdrawn', entityType: 'pickup_slot_proposal', entityId: id,
        oldValue: { status: p.status }, newValue: { status: 'withdrawn' }, reason, ip: a.ip ?? null });
      return { id, status: 'withdrawn' as const };
    }, { userId: a.userId }));
  }

  async list(tenantId: string, a: SlotDeskActor, q: { status?: string; sellerUserId?: string; cursor?: KeysetCursor; limit: number }) {
    this.assertManager(a);
    const rows = await this.repo.list(tenantId, q);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.wire(r, { forDesk: true })), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdUs, last.id) : null };
  }
  async get(tenantId: string, a: SlotDeskActor, id: string) {
    this.assertManager(a);
    const r = await this.repo.get(tenantId, id);
    if (!r) throw new SlotProposalNotFoundError(id);
    return this.wire(r, { forDesk: true });
  }

  /* ─────────────── the member: in the app ─────────────── */
  async mine(tenantId: string, userId: string) {
    const rows = await this.repo.list(tenantId, { sellerUserId: userId, limit: 50 });
    return { items: rows.map((r) => this.wire(r, { forDesk: false })) };
  }
  async decideInApp(tenantId: string, userId: string, id: string, decision: SlotDecision, key: string, reason?: string | null) {
    return this.idem.remember(key, userId, `logistics.slot_proposal_${decision}`, () => this.decideIn(tenantId, userId, id, decision, 'app', reason ?? null));
  }

  /* ─────────────── the member: the OTP link (no session) ─────────────── */
  /** What the link page needs to start: windows, status, the organisation's name, the phone tail the code goes to. Nothing else. */
  async linkView(id: string) {
    const r = await this.pools.writer(0).query(`SELECT tenant_id, status, slots, expires_at, phone_tail, tenant_name FROM kv_slot_proposal_link($1::uuid)`, [id]);
    const x = r.rows[0] as any;
    if (!x) throw new NotFoundError('Not found');
    await this.assertFlag(x.tenant_id);
    return { id, status: x.status as string, windows: x.slots as SlotWindow[], expiresAt: new Date(x.expires_at).toISOString(), phoneTail: `••••${x.phone_tail}`, organisation: x.tenant_name as string };
  }
  async linkSendCode(id: string) {
    const v = await this.linkView(id);
    if (v.status !== 'proposed') throw new LogisticsOpsRefusedError('SLOT_PROPOSAL_CLOSED', `This proposal is already ${v.status}`, 409);
    const tenantId = await this.tenantOfLink(id);
    const seller = await this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.getForUpdate(tx, tenantId, id);
      return p ? await this.repo.sellerKnown(tx, tenantId, p.sellerUserId) : null;
    });
    if (!seller) throw new NotFoundError('Not found');
    const { ttlSec } = await this.otp.send('slot_proposal', id, seller.phone, seller.language);
    return { sent: true as const, phoneTail: v.phoneTail, ttlSec };
  }
  async linkDecide(id: string, code: string, decision: SlotDecision, reason?: string | null) {
    const tenantId = await this.tenantOfLink(id);
    await this.assertFlag(tenantId);
    const p = await this.repo.get(tenantId, id);
    if (!p || !p.sellerPhone) throw new NotFoundError('Not found');
    if (!(await this.otp.verify('slot_proposal', id, p.sellerPhone, code))) {
      throw new LogisticsOpsRefusedError('SLOT_OTP_INVALID', 'That code is not right, or it expired — ask for a new one', 401);
    }
    // the code went to the SELLER's own phone and verified: the decision is written in a unit of work whose app.user_id is the seller
    return this.decideIn(tenantId, p.sellerUserId, id, decision, 'otp_link', reason ?? null);
  }
  private async tenantOfLink(id: string): Promise<string> {
    const r = await this.pools.writer(0).query(`SELECT tenant_id FROM kv_slot_proposal_link($1::uuid)`, [id]);
    if (!r.rows[0]) throw new NotFoundError('Not found');
    return (r.rows[0] as { tenant_id: string }).tenant_id;
  }

  private async decideIn(tenantId: string, userId: string, id: string, decision: SlotDecision, channel: 'app' | 'otp_link', reason: string | null) {
    await this.assertFlag(tenantId);
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.getForUpdate(tx, tenantId, id);
      if (!p) throw new SlotProposalNotFoundError(id);
      try {
        // the DECISION first (0201's proposal wall: only the seller's session may decide), then — on accept — the windows, written
        // in that same session (the pickup_slots owner wall), then which windows were written (recorded once)
        await this.repo.decide(tx, tenantId, id, { status: decision === 'accept' ? 'accepted' : 'declined', by: userId, channel, declineReason: decision === 'decline' ? (reason?.trim() || null) : null, appliedSlotIds: [] });
        const applied = decision === 'accept' ? await this.repo.applyWindows(tx, tenantId, p.sellerUserId, p.slots) : [];
        if (applied.length) await this.repo.recordApplied(tx, tenantId, id, applied);
        await this.audit.write(tx, { tenantId, actorUserId: userId, action: `logistics.slot_proposal_${decision === 'accept' ? 'accepted' : 'declined'}`, entityType: 'pickup_slot_proposal', entityId: id,
          oldValue: { status: p.status }, newValue: { status: decision === 'accept' ? 'accepted' : 'declined', channel, windowsWritten: applied.length }, reason: reason?.trim() || null });
        return { id, status: decision === 'accept' ? 'accepted' as const : 'declined' as const, channel, windowsWritten: applied.length };
      } catch (e) { rethrowGate(e); }
    }, { userId });
  }

  /** The 7-day clock, per tenant (kv_app UoW). */
  async expireDue(tenantId: string): Promise<number> {
    return this.uow.run(tenantId, (tx) => this.repo.expireDue(tx, tenantId), { userId: 'system' });
  }

  private linkFor(id: string): string {
    const base = (this.config.tenantConsoleBaseUrl ?? '').replace(/\/+$/, '');
    return base ? `${base}/slot-proposal/${id}` : `/slot-proposal/${id}`;
  }
  private wire(r: ProposalRow, o: { forDesk: boolean }) {
    return {
      id: r.id, sellerUserId: r.sellerUserId, sellerName: shortName(r.sellerName), sellerPhoneMasked: o.forDesk && r.sellerPhone ? maskPhone(r.sellerPhone) : null,
      proposedBy: r.proposedBy, windows: r.slots, reason: r.reason, status: r.status, expiresAt: r.expiresAt, decidedAt: r.decidedAt, channel: r.channel,
      declineReason: r.declineReason, withdrawnAt: r.withdrawnAt, withdrawReason: r.withdrawReason, windowsWritten: r.appliedSlotIds.length, createdAt: r.createdAt,
    };
  }
}
