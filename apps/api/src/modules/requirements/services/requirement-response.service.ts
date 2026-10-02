// modules/requirements/services/requirement-response.service.ts
// Seller-quote use-cases on a requirement. Every write: one ACID tx (UoW), status via the machine
// (Law 5), outbox events in the SAME tx (Law 4). NO money moves here — an accepted quote emits
// requirements.quote_accepted (carrying the order inputs) and the order is created downstream
// (orders, Law 11). Seller/listing authority comes from ListingService (Law 11). No version columns →
// the response (and the requirement it fulfils) are locked FOR UPDATE.
//
// PC-56 TENANT-11d:
//   • A2 (F-11) — accept BY QUANTITY: the buyer accepts all of a quote or part of it; the requirement's fulfilled quantity grows
//     by what was accepted and its status follows the quantity (partially_matched / fulfilled). A POOLED quote is accepted (or
//     rejected) as a whole — every line in ONE transaction. Each accepted response emits its own `requirements.quote_accepted`,
//     and orders makes ONE order per response, in the requirement's unit (orders/events/handlers/quote-accepted.handler.ts).
//     A shortlist is a response status only — it no longer moves the requirement.
//   • A4 (F-10) — only the buyer decides; the buyer desk decides FOR the buyer only with the buyer's recorded consent for that act
//     (services/buyer-consent.ts). Moderators read; they no longer accept, shortlist or reject.
//   • A7 (F-24 / F-25 / F-27c) — submit, shortlist, accept, reject and the group decisions are audited (actor · reason ·
//     before/after · ip); the responses list is a µs keyset and a seller's own view is filtered in SQL.
//   • A5 (F-14) — every row the buyer / desk / moderator reads carries the seller's short name + masked phone, the status, the
//     group id and the consent state.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ListingService } from '../../listings/services/listing.service';
import { RequirementResponse } from '../domain/requirement-response.entity';
import { Requirement } from '../domain/requirement.entity';
import { DomainEvent, GroupEventType } from '../domain/requirements.events';
import { isLive } from '../domain/requirement-response.state';
import { isAcceptingResponses } from '../domain/requirement.state';
import { Cursor, encodeCursor } from '../domain/cursor';
import { maskPhone, shortName } from '../domain/display';
import { formatQtyMilli, isQty, parseQtyMilli } from '../domain/quantity';
import {
  RequirementNotFoundError, ResponseNotFoundError, RequirementForbiddenError, RequirementNotOpenError,
  SellerIsBuyerError, DuplicateResponseError, InvalidResponseError, ResponseNotAcceptableError, ResponseGroupNotFoundError,
  ResponseGroupStateError, AcceptQuantityError,
} from '../domain/requirements.errors';
import { RequirementRepository } from '../repositories/requirement.repository';
import { RequirementResponseRepository } from '../repositories/requirement-response.repository';
import { ResponseGroupRepository } from '../repositories/response-group.repository';
import { CreateResponseDto } from '../dto/create-requirement-response.dto';
import { AcceptResponseDto, DecideDto } from '../dto/requirement-desk.dto';
import { RequirementActor, seesAll } from '../policies/requirements.policies';
import { authorizeBuyerDecision } from './buyer-consent';

export type { RequirementActor } from '../policies/requirements.policies';

@Injectable()
export class RequirementResponseService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly listings: ListingService,
    private readonly requirements: RequirementRepository,
    private readonly repo: RequirementResponseRepository,
    private readonly groups: ResponseGroupRepository,
  ) {}

  private audited(tx: TxContext, e: { tenantId: string; actorUserId: string | null; action: string; entityType?: string; id: string; oldValue?: unknown; newValue?: unknown; reason?: string | null; ip: string | null }) {
    return this.audit.write(tx, { tenantId: e.tenantId, actorUserId: e.actorUserId, action: e.action, entityType: e.entityType ?? 'requirement_response', entityId: e.id,
      oldValue: e.oldValue ?? null, newValue: e.newValue ?? null, reason: e.reason ?? null, ip: e.ip });
  }

  /** A seller submits a quote on someone else's OPEN requirement, with their OWN published listing (unchanged rule). Audited. */
  async submit(tenantId: string, sellerUserId: string, requirementId: string, idemKey: string, dto: CreateResponseDto, ip: string | null = null) {
    return this.idem.remember(idemKey, sellerUserId, 'requirements.quote', () =>
      timed(this.metrics, 'requirements.quote', { tenant: tenantId }, async () => {
        const req = await this.requirements.getById(tenantId, requirementId);
        if (!req) throw new RequirementNotFoundError(requirementId);
        if (!isAcceptingResponses(req.status)) throw new RequirementNotOpenError(req.status);
        if (req.buyerUserId === sellerUserId) throw new SellerIsBuyerError();
        // a quote that names a listing must name the seller's OWN published listing
        if (dto.listingId) {
          const l: any = await this.listings.getById(tenantId, dto.listingId);
          if (!l || l.status !== 'published') throw new InvalidResponseError('listing not found or not published');
          if (l.sellerUserId !== sellerUserId) throw new InvalidResponseError('you can only quote your own listing');
        }
        const response = RequirementResponse.submit({
          id: uuidv7(), requirementId, tenantId, sellerUserId, listingId: dto.listingId ?? null,
          quotedPriceMinor: BigInt(dto.quotedPriceMinor), quantity: dto.quantity,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null, message: dto.message ?? null,
        });
        return this.uow.run(tenantId, async (tx) => {
          const inserted = await this.repo.insert(tx, response);
          if (!inserted) throw new DuplicateResponseError();
          const p = response.toProps();
          await this.audited(tx, { tenantId, actorUserId: sellerUserId, action: 'requirement.response_submitted', id: p.id, ip,
            newValue: { requirementId, listingId: p.listingId, quantity: p.quantity, quotedPriceMinor: p.quotedPriceMinor.toString(), validUntil: p.validUntil } });
          await this.flush(tx, tenantId, p.id, response.pullEvents());
          return this.serialize(p);
        }, { userId: sellerUserId });
      }));
  }

  /** The buyer shortlists a quote (or the desk, with the buyer's consent). A response status only — the requirement stays as it is. */
  async shortlist(tenantId: string, actor: RequirementActor, responseId: string, ip: string | null = null, dto: DecideDto = {}) {
    return timed(this.metrics, 'requirements.shortlist', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const { resp, req } = await this.locked(tx, tenantId, responseId);
        const auth = await authorizeBuyerDecision(tx, this.groups, { tenantId, requirementId: req.id, buyerUserId: req.buyerUserId, actor, act: 'shortlist', consent: dto.consent, responseId });
        const from = resp.status;
        resp.shortlist();
        await this.repo.update(tx, resp);
        await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.response_shortlisted', id: responseId, ip,
          oldValue: { status: from }, newValue: { status: resp.status, requirementId: req.id, onBehalf: auth.onBehalf, consentId: auth.consentId } });
        await this.flush(tx, tenantId, responseId, resp.pullEvents());
        return this.serialize(resp.toProps());
      }, { userId: actor.userId }));
  }

  /** The buyer rejects a quote (or the desk, with the buyer's consent), or the quote's seller withdraws their own. */
  async reject(tenantId: string, actor: RequirementActor, responseId: string, ip: string | null = null, dto: DecideDto = {}) {
    return this.uow.run(tenantId, async (tx) => {
      const { resp, req } = await this.locked(tx, tenantId, responseId);
      const isSellerOwner = resp.sellerUserId === actor.userId;
      const auth = isSellerOwner ? { onBehalf: false, consentId: null }
        : await authorizeBuyerDecision(tx, this.groups, { tenantId, requirementId: req.id, buyerUserId: req.buyerUserId, actor, act: 'reject', consent: dto.consent, responseId });
      const from = resp.status;
      resp.reject();
      await this.repo.update(tx, resp);
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: isSellerOwner ? 'requirement.response_withdrawn' : 'requirement.response_rejected', id: responseId, ip,
        oldValue: { status: from }, newValue: { status: resp.status, requirementId: req.id, by: isSellerOwner ? 'seller' : 'buyer', onBehalf: auth.onBehalf, consentId: auth.consentId } });
      await this.flush(tx, tenantId, responseId, resp.pullEvents());
      return this.serialize(resp.toProps());
    }, { userId: actor.userId });
  }

  /** A2 — the buyer accepts a quote, all of it or `quantity` of it (or the desk, with the buyer's consent). The requirement's
   *  fulfilled quantity grows by the accepted quantity; requirements.quote_accepted → ONE order for this response (orders). */
  async accept(tenantId: string, actor: RequirementActor, responseId: string, ip: string | null, dto: AcceptResponseDto = {}) {
    return timed(this.metrics, 'requirements.accept', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const { resp, req } = await this.locked(tx, tenantId, responseId);
        if (!isAcceptingResponses(req.status)) throw new RequirementNotOpenError(req.status);
        const auth = await authorizeBuyerDecision(tx, this.groups, { tenantId, requirementId: req.id, buyerUserId: req.buyerUserId, actor, act: 'accept', consent: dto.consent, responseId });
        if (dto.quantity !== undefined && (!isQty(dto.quantity) || parseQtyMilli(dto.quantity) <= 0n || parseQtyMilli(dto.quantity) > parseQtyMilli(resp.quantity))) throw new AcceptQuantityError(resp.quantity);
        await this.assertPurchasable(tx, tenantId, resp, dto.quantity ?? resp.quantity);
        const before = { status: resp.status, requirementStatus: req.status, fulfilledQuantity: req.fulfilledQuantity };
        const taken = resp.accept({ buyerUserId: req.buyerUserId, acceptedBy: actor.userId, now: new Date(), quantity: dto.quantity ?? null, unitCode: req.unitCode, decisionConsentId: auth.consentId });
        const f = req.recordAccepted(taken, [resp.id]);
        await this.repo.update(tx, resp);
        await this.requirements.update(tx, req);
        await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.quote_accepted', id: responseId, ip,
          oldValue: before,
          newValue: { status: 'accepted', requirementId: req.id, sellerUserId: resp.sellerUserId, acceptedQuantity: formatQtyMilli(taken), quotedQuantity: resp.quantity,
            partial: taken < parseQtyMilli(resp.quantity), unitCode: req.unitCode, requirementStatus: req.status, fulfilledQuantity: f.after, onBehalf: auth.onBehalf, consentId: auth.consentId } });
        await this.flush(tx, tenantId, responseId, resp.pullEvents());
        await this.flushReq(tx, tenantId, req.id, req.pullEvents());
        return { ...this.serialize(resp.toProps()), requirement: { status: req.status, fulfilledQuantity: req.fulfilledQuantity, quantity: req.quantity } };
      }, { userId: actor.userId }));
  }

  /** A2 — the buyer accepts a POOLED quote: every live line response in ONE transaction, each for its full quantity; the
   *  requirement's fulfilled quantity grows by their sum; each response emits its own quote_accepted (one order per member). */
  async acceptGroup(tenantId: string, actor: RequirementActor, groupId: string, ip: string | null, dto: DecideDto = {}) {
    return timed(this.metrics, 'requirements.accept_group', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const { group, req, resps } = await this.lockedGroup(tx, tenantId, groupId);
        if (!isAcceptingResponses(req.status)) throw new RequirementNotOpenError(req.status);
        const auth = await authorizeBuyerDecision(tx, this.groups, { tenantId, requirementId: req.id, buyerUserId: req.buyerUserId, actor, act: 'accept', consent: dto.consent, groupId });
        const live = resps.filter((r) => isLive(r.status));
        if (live.length !== resps.length || live.length === 0) throw new ResponseGroupStateError(group.status, 'Every line of the pooled quote must still be live to accept it together');
        for (const r of live) await this.assertPurchasable(tx, tenantId, r, r.quantity);
        const before = { groupStatus: group.status, requirementStatus: req.status, fulfilledQuantity: req.fulfilledQuantity };
        const now = new Date();
        let total = 0n;
        for (const r of live) total += r.accept({ buyerUserId: req.buyerUserId, acceptedBy: actor.userId, now, quantity: null, unitCode: req.unitCode, decisionConsentId: auth.consentId });
        const f = req.recordAccepted(total, live.map((r) => r.id));
        for (const r of live) { await this.repo.update(tx, r); await this.flush(tx, tenantId, r.id, r.pullEvents()); }
        await this.requirements.update(tx, req);
        await this.groups.markDecided(tx, tenantId, groupId, 'accepted', actor.userId, auth.consentId);
        await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_accepted', entityType: 'requirement_response_group', id: groupId, ip,
          oldValue: before,
          newValue: { groupStatus: 'accepted', requirementId: req.id, responses: live.map((r) => ({ id: r.id, sellerUserId: r.sellerUserId, quantity: r.acceptedQuantity })),
            acceptedQuantity: formatQtyMilli(total), unitCode: req.unitCode, requirementStatus: req.status, fulfilledQuantity: f.after, onBehalf: auth.onBehalf, consentId: auth.consentId } });
        await this.outbox.write(tx, { tenantId, aggregateType: 'requirement_response_group', aggregateId: groupId, eventType: GroupEventType.Accepted,
          payload: { v: 1, groupId, requirementId: req.id, responseIds: live.map((r) => r.id), acceptedQuantity: formatQtyMilli(total) } });
        await this.flushReq(tx, tenantId, req.id, req.pullEvents());
        return { groupId, status: 'accepted' as const, responses: live.map((r) => this.serialize(r.toProps())), requirement: { status: req.status, fulfilledQuantity: req.fulfilledQuantity, quantity: req.quantity } };
      }, { userId: actor.userId }));
  }

  /** The buyer rejects a POOLED quote: every live line response in ONE transaction. */
  async rejectGroup(tenantId: string, actor: RequirementActor, groupId: string, ip: string | null, dto: DecideDto = {}) {
    return this.uow.run(tenantId, async (tx) => {
      const { group, req, resps } = await this.lockedGroup(tx, tenantId, groupId);
      const auth = await authorizeBuyerDecision(tx, this.groups, { tenantId, requirementId: req.id, buyerUserId: req.buyerUserId, actor, act: 'reject', consent: dto.consent, groupId });
      const live = resps.filter((r) => isLive(r.status));
      for (const r of live) { r.reject(); await this.repo.update(tx, r); await this.flush(tx, tenantId, r.id, r.pullEvents()); }
      await this.groups.markDecided(tx, tenantId, groupId, 'rejected', actor.userId, auth.consentId);
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_rejected', entityType: 'requirement_response_group', id: groupId, ip,
        oldValue: { groupStatus: group.status }, newValue: { groupStatus: 'rejected', requirementId: req.id, rejected: live.map((r) => r.id), onBehalf: auth.onBehalf, consentId: auth.consentId } });
      await this.outbox.write(tx, { tenantId, aggregateType: 'requirement_response_group', aggregateId: groupId, eventType: GroupEventType.Rejected, payload: { v: 1, groupId, requirementId: req.id } });
      return { groupId, status: 'rejected' as const };
    }, { userId: actor.userId });
  }

  /** Expiry (the cadence sweep's act): lapse a live quote past valid_until. Re-locks and re-checks. */
  async expireResponse(tenantId: string, responseId: string, now: Date = new Date()): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const resp = await this.repo.getForUpdate(tx, tenantId, responseId);
      if (!resp || !isLive(resp.status)) return false;
      const vu = resp.validUntil;
      if (!vu || vu.getTime() >= now.getTime()) return false;
      resp.expire();
      await this.repo.update(tx, resp);
      await this.audited(tx, { tenantId, actorUserId: null, action: 'requirement.response_expired', id: responseId, ip: null, reason: 'quote validity passed',
        oldValue: { status: 'live' }, newValue: { status: 'expired', validUntil: vu } });
      await this.flush(tx, tenantId, responseId, resp.pullEvents());
      return true;
    }, { userId: 'system' });
  }

  async getById(tenantId: string, actor: RequirementActor, responseId: string) {
    const resp = await this.repo.getById(tenantId, responseId);
    if (!resp) throw new ResponseNotFoundError(responseId);
    const req = await this.requirements.getById(tenantId, resp.requirementId);
    const isBuyer = req?.buyerUserId === actor.userId;
    if (!seesAll(actor) && !isBuyer && resp.sellerUserId !== actor.userId) throw new RequirementForbiddenError();
    return this.serialize(resp.toProps());
  }

  /** Quotes on a requirement: the buyer, the desk and moderators see all (seller short name + masked phone); a seller sees only
   *  their own — filtered IN SQL (F-27c), so a seller's page is never emptied by competitors' rows. */
  async listForRequirement(tenantId: string, actor: RequirementActor, requirementId: string, q: { status?: string; cursor?: Cursor; limit: number }) {
    const req = await this.requirements.getById(tenantId, requirementId);
    if (!req) throw new RequirementNotFoundError(requirementId);
    const full = seesAll(actor) || req.buyerUserId === actor.userId;
    const rows = await this.repo.listForRequirement(tenantId, requirementId, { status: q.status, sellerUserId: full ? undefined : actor.userId, cursor: q.cursor, limit: q.limit });
    const items = rows.map((x) => ({
      ...this.serialize(x.entity.toProps()),
      sellerShortName: shortName(x.sellerName),
      sellerPhoneMasked: x.sellerPhone ? maskPhone(x.sellerPhone) : null,
      listingTitle: x.listingTitle,
      aboveCeiling: req.budgetMaxMinor != null && x.entity.toProps().quotedPriceMinor > req.budgetMaxMinor,
    }));
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeCursor('created', last.createdAtRaw, last.entity.id) : null;
    return { items, nextCursor };
  }

  // ---- helpers ----
  private async locked(tx: TxContext, tenantId: string, responseId: string): Promise<{ resp: RequirementResponse; req: Requirement }> {
    const resp = await this.repo.getForUpdate(tx, tenantId, responseId);
    if (!resp) throw new ResponseNotFoundError(responseId);
    const req = await this.requirements.getForUpdate(tx, tenantId, resp.requirementId);
    if (!req) throw new RequirementNotFoundError(resp.requirementId);
    return { resp, req };
  }
  private async lockedGroup(tx: TxContext, tenantId: string, groupId: string) {
    const group = await this.groups.groupForUpdate(tx, tenantId, groupId);
    if (!group) throw new ResponseGroupNotFoundError(groupId);
    if (group.status !== 'submitted') throw new ResponseGroupStateError(group.status, `The pooled quote is ${group.status} — only a sent quote can be decided`);
    const req = await this.requirements.getForUpdate(tx, tenantId, group.requirementId);
    if (!req) throw new RequirementNotFoundError(group.requirementId);
    const resps = await this.repo.forGroupForUpdate(tx, tenantId, groupId);
    return { group, req, resps };
  }
  /** The order an accepted quote becomes needs a published listing with the stock (fresh read on this transaction). */
  private async assertPurchasable(tx: TxContext, tenantId: string, resp: RequirementResponse, qty: string): Promise<void> {
    if (!resp.listingId) throw new ResponseNotAcceptableError();
    const l = await this.listings.stockForQuoteInTx(tx, tenantId, resp.listingId);
    if (!l || l.status !== 'published' || l.sellerUserId !== resp.sellerUserId) throw new ResponseNotAcceptableError();
    if (isQty(l.quantityAvailable) && parseQtyMilli(l.quantityAvailable) < parseQtyMilli(qty)) {
      throw new InvalidResponseError(`the listing now has ${l.quantityAvailable} available — less than the ${qty} to accept`);
    }
  }
  private serialize(p: ReturnType<RequirementResponse['toProps']>) {
    return { id: p.id, requirementId: p.requirementId, sellerUserId: p.sellerUserId, listingId: p.listingId,
      quotedPriceMinor: p.quotedPriceMinor.toString(), quantity: p.quantity, validUntil: p.validUntil, message: p.message, status: p.status, createdAt: p.createdAt,
      groupId: p.groupId ?? null, consentState: p.groupId ? (p.consentId ? 'recorded' : 'missing') : 'own_quote',
      acceptedQuantity: p.acceptedQuantity ?? null, orderId: p.orderId ?? null, onBehalfDecision: !!p.decisionConsentId };
  }
  private async flush(tx: TxContext, tenantId: string, responseId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'requirement_response', aggregateId: responseId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
  private async flushReq(tx: TxContext, tenantId: string, requirementId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'requirement', aggregateId: requirementId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
