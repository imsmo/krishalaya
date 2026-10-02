// modules/requirements/services/response-group.service.ts · PC-56 TENANT-11d · F-11 / F-20 / A1 / A6 — "RESPOND WITH MEMBER STOCK".
//
// Founder decision: LINKED RESPONSES, ONE ORDER PER MEMBER, PER-MEMBER CONSENT BEFORE SEND. Canon W132: "17 + 23 = 40 qtl — two
// members fill it exactly … Both members confirm by voice/app before the quote is sent (their produce, their yes) … sends as two
// linked responses (one per member, status submitted)".
//
//   matches  GET  /requirements/:id/matches            — the rule-based member-stock read (no AI score exists; none is faked)
//   draft    POST /requirements/:id/response-groups    — the desk opens a pooled quote (a server row: the draft is KEPT)
//   line     POST …/response-groups/:gid/lines         — a member's published listing, quantity ≤ available, price (prefilled
//                                                       from the listing, editable); one line per member; never the buyer
//   edit     PATCH …/lines/:lid                        — new figures clear the member's consent (DB trigger): a new yes is needed
//   remove   POST …/lines/:lid/remove
//   consent  POST …/lines/:lid/consent                 — the member's yes to EXACTLY this listing, quantity and price; recorded
//                                                       by the desk (otp | voice | written + evidence) or by the member as self (app)
//   send     POST …/response-groups/:gid/send          — refused while ANY line lacks consent (CONSENT_MISSING names the member);
//                                                       otherwise ONE transaction writes one requirement_responses row per line
//                                                       (status submitted, group_id, consent_id, valid 48 h), audited, and
//                                                       `requirement.group_quoted` reaches the buyer
//   withdraw POST …/response-groups/:gid/withdraw      — the desk drops a draft, or withdraws a sent quote (its live responses lapse)
//
// Who: `requirement.desk` (tenant_admin, fpo_coordinator) for every act; the member themself may record their own consent.
// Money: none. Each accepted response later becomes its own order, which settles its own farmer directly as every order does.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ListingService } from '../../listings/services/listing.service';
import { RequirementResponse } from '../domain/requirement-response.entity';
import { Requirement } from '../domain/requirement.entity';
import { DomainEvent, GroupEventType } from '../domain/requirements.events';
import { isAcceptingResponses } from '../domain/requirement.state';
import { isLive } from '../domain/requirement-response.state';
import { GROUP_VALID_MS, GroupStatus, assertGroupTransition, draftStatusFor, isEditable } from '../domain/response-group';
import { aboveCeiling, blend, formatQtyMilli, isQty, lineValueMinor, parseQtyMilli } from '../domain/quantity';
import { MATCH_RULE, cleanReason, maskPhone, shortName } from '../domain/display';
import {
  RequirementNotFoundError, RequirementNotOpenError, RequirementDeskForbiddenError, ConsentMissingError, ResponseGroupNotFoundError, GroupLineNotFoundError,
  ResponseGroupStateError, EmptyResponseGroupError, GroupLineInvalidError, BuyerConsentRequiredError, DuplicateResponseError,
} from '../domain/requirements.errors';
import { RequirementRepository } from '../repositories/requirement.repository';
import { RequirementResponseRepository } from '../repositories/requirement-response.repository';
import { GroupRow, LineRow, ResponseGroupRepository } from '../repositories/response-group.repository';
import { AddLineDto, ConsentDto, EditLineDto } from '../dto/requirement-desk.dto';
import { RequirementActor } from '../policies/requirements.policies';

const MATCH_LIMIT = 25;

@Injectable()
export class ResponseGroupService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly listings: ListingService,
    private readonly requirements: RequirementRepository,
    private readonly responses: RequirementResponseRepository,
    private readonly repo: ResponseGroupRepository,
  ) {}

  private audited(tx: TxContext, e: { tenantId: string; actorUserId: string; action: string; groupId: string; oldValue?: unknown; newValue?: unknown; reason?: string | null; ip: string | null }) {
    return this.audit.write(tx, { tenantId: e.tenantId, actorUserId: e.actorUserId, action: e.action, entityType: 'requirement_response_group', entityId: e.groupId,
      oldValue: e.oldValue ?? null, newValue: e.newValue ?? null, reason: e.reason ?? null, ip: e.ip });
  }
  private assertDesk(actor: RequirementActor) { if (!actor.canDesk) throw new RequirementDeskForbiddenError(); }

  // ---------------------------------------------------------------------------------------------------------------------------
  // A6 · THE MEMBER-STOCK MATCH (rule-based; "AI score not yet available")
  // ---------------------------------------------------------------------------------------------------------------------------
  async matches(tenantId: string, actor: RequirementActor, requirementId: string) {
    this.assertDesk(actor);
    const req = await this.requirements.getById(tenantId, requirementId);
    if (!req) throw new RequirementNotFoundError(requirementId);
    const p = req.toProps();
    const rows = await this.listings.memberStockForRequirement(tenantId, { productId: p.productId, categoryId: p.productId ? null : p.categoryId, unitCode: p.unitCode,
      excludeSellerId: p.buyerUserId, deliveryPincode: p.deliveryPincode, limit: MATCH_LIMIT });
    const remaining = parseQtyMilli(p.quantity) - parseQtyMilli(req.fulfilledQuantity);
    return {
      rule: MATCH_RULE,
      ruleCode: 'rule_based',
      aiScore: { available: false as const },
      basis: p.productId ? 'product' : p.categoryId ? 'category' : 'none',
      orderedBy: rows.some((r) => r.distanceKm !== null) ? 'price_then_distance' : 'price',
      unitCode: p.unitCode,
      remainingQuantity: formatQtyMilli(remaining > 0n ? remaining : 0n),
      items: rows.map((r) => {
        const avail = isQty(r.quantityAvailable) ? parseQtyMilli(r.quantityAvailable) : 0n;
        const suggest = remaining > 0n ? (avail < remaining ? avail : remaining) : 0n;
        return { listingId: r.id, title: r.title, sellerUserId: r.sellerUserId, sellerShortName: shortName(r.sellerName), sellerPhoneMasked: r.sellerPhone ? maskPhone(r.sellerPhone) : null,
          quantityAvailable: formatQtyMilli(avail), unitCode: r.unitCode, priceMinor: r.priceMinor, pincode: r.pincode, distanceKm: r.distanceKm, matchedOn: r.matchedOn,
          aboveCeiling: aboveCeiling(BigInt(r.priceMinor), p.budgetMaxMinor), suggestedQuantity: formatQtyMilli(suggest) };
      }),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // A1 · THE DRAFT
  // ---------------------------------------------------------------------------------------------------------------------------
  async createDraft(tenantId: string, actor: RequirementActor, requirementId: string, ip: string | null) {
    this.assertDesk(actor);
    return this.uow.run(tenantId, async (tx) => {
      const req = await this.requirements.getForUpdate(tx, tenantId, requirementId);
      if (!req) throw new RequirementNotFoundError(requirementId);
      if (!isAcceptingResponses(req.status)) throw new RequirementNotOpenError(req.status);
      const id = uuidv7();
      await this.repo.insertGroup(tx, { id, tenantId, requirementId, createdBy: actor.userId });
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_created', groupId: id, ip, newValue: { requirementId, status: 'draft' } });
      return this.view(tx, tenantId, id, req);
    }, { userId: actor.userId });
  }

  async addLine(tenantId: string, actor: RequirementActor, groupId: string, dto: AddLineDto, ip: string | null) {
    this.assertDesk(actor);
    return timed(this.metrics, 'requirements.group_line', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const { group, req } = await this.editable(tx, tenantId, groupId);
        const stock = await this.stockFor(tx, tenantId, req, dto.listingId, dto.quantity);
        const price = dto.priceMinor ? BigInt(dto.priceMinor) : stock.priceMinor;
        if ((await this.responses.sellersWithResponse(tx, tenantId, req.id, [stock.sellerUserId])).length > 0) {
          throw new GroupLineInvalidError('REQUIREMENT_LINE_MEMBER_ALREADY_QUOTED', 'This member already has a response on this requirement (one per member)', { sellerUserId: stock.sellerUserId });
        }
        const id = uuidv7();
        const quantity = formatQtyMilli(parseQtyMilli(dto.quantity));
        const ok = await this.repo.insertLine(tx, { id, tenantId, groupId, requirementId: req.id, sellerUserId: stock.sellerUserId, listingId: stock.id, quantity, priceMinor: price, createdBy: actor.userId });
        if (!ok) throw new GroupLineInvalidError('REQUIREMENT_LINE_MEMBER_DUPLICATE', 'This member already has a line in this quote — edit it instead', { sellerUserId: stock.sellerUserId });
        const f = await this.refigure(tx, tenantId, group);
        await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_line_added', groupId, ip,
          oldValue: { totalQuantity: group.totalQuantity, status: group.status },
          newValue: { lineId: id, sellerUserId: stock.sellerUserId, listingId: stock.id, quantity, priceMinor: price.toString(), aboveCeiling: aboveCeiling(price, req.budgetMaxMinor),
            totalQuantity: f.totalQuantity, status: f.status } });
        return this.view(tx, tenantId, groupId, req);
      }, { userId: actor.userId }));
  }

  async editLine(tenantId: string, actor: RequirementActor, groupId: string, lineId: string, dto: EditLineDto, ip: string | null) {
    this.assertDesk(actor);
    return this.uow.run(tenantId, async (tx) => {
      const { group, req } = await this.editable(tx, tenantId, groupId);
      const line = await this.repo.lineForUpdate(tx, tenantId, groupId, lineId);
      if (!line || line.status !== 'active') throw new GroupLineNotFoundError(lineId);
      const quantity = dto.quantity !== undefined ? formatQtyMilli(parseQtyMilli(dto.quantity)) : line.quantity;
      if (dto.quantity !== undefined) await this.stockFor(tx, tenantId, req, line.listingId, quantity);
      const price = dto.priceMinor !== undefined ? BigInt(dto.priceMinor) : line.priceMinor;
      await this.repo.updateLine(tx, tenantId, lineId, { quantity, priceMinor: price });
      const f = await this.refigure(tx, tenantId, group);
      const consentCleared = !!line.consentId && (quantity !== line.quantity || price !== line.priceMinor);
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_line_edited', groupId, ip,
        oldValue: { lineId, quantity: line.quantity, priceMinor: line.priceMinor.toString(), consentId: line.consentId },
        newValue: { lineId, quantity, priceMinor: price.toString(), consentCleared, totalQuantity: f.totalQuantity, status: f.status } });
      return this.view(tx, tenantId, groupId, req);
    }, { userId: actor.userId });
  }

  async removeLine(tenantId: string, actor: RequirementActor, groupId: string, lineId: string, ip: string | null) {
    this.assertDesk(actor);
    return this.uow.run(tenantId, async (tx) => {
      const { group, req } = await this.editable(tx, tenantId, groupId);
      const line = await this.repo.lineForUpdate(tx, tenantId, groupId, lineId);
      if (!line || line.status !== 'active') throw new GroupLineNotFoundError(lineId);
      await this.repo.removeLine(tx, tenantId, lineId);
      const f = await this.refigure(tx, tenantId, group);
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_line_removed', groupId, ip,
        oldValue: { lineId, sellerUserId: line.sellerUserId, quantity: line.quantity, priceMinor: line.priceMinor.toString() }, newValue: { totalQuantity: f.totalQuantity, status: f.status } });
      return this.view(tx, tenantId, groupId, req);
    }, { userId: actor.userId });
  }

  /** The member's yes to THEIR line — recorded by the desk (otp / voice / written + evidence), or by the member themself (`app`). */
  async recordConsent(tenantId: string, actor: RequirementActor, groupId: string, lineId: string, dto: ConsentDto, ip: string | null) {
    return this.uow.run(tenantId, async (tx) => {
      const { group, req } = await this.editable(tx, tenantId, groupId);
      const line = await this.repo.lineForUpdate(tx, tenantId, groupId, lineId);
      if (!line || line.status !== 'active') throw new GroupLineNotFoundError(lineId);
      const self = actor.userId === line.sellerUserId;
      if (!self && !actor.canDesk) throw new RequirementDeskForbiddenError('only the member themself or the buyer desk may record this consent');
      if (dto.channel === 'app' && !self) throw new BuyerConsentRequiredError('quote', 'REQUIREMENT_CONSENT_EVIDENCE_REQUIRED');
      if (dto.channel !== 'otp' && dto.channel !== 'app' && !dto.mediaId) throw new BuyerConsentRequiredError('quote', 'REQUIREMENT_CONSENT_EVIDENCE_REQUIRED');
      const id = uuidv7();
      await this.repo.insertConsent(tx, { id, tenantId, requirementId: req.id, act: 'quote', memberUserId: line.sellerUserId, groupId, lineId, listingId: line.listingId,
        quantity: line.quantity, priceMinor: line.priceMinor, channel: dto.channel, mediaId: dto.mediaId ?? null, note: dto.note?.trim() || null, recordedBy: actor.userId });
      await this.repo.setLineConsent(tx, tenantId, lineId, id);
      const f = await this.refigure(tx, tenantId, group);
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_consent_recorded', groupId, ip,
        oldValue: { lineId, consentId: line.consentId },
        newValue: { lineId, consentId: id, memberUserId: line.sellerUserId, channel: dto.channel, mediaId: dto.mediaId ?? null, self, listingId: line.listingId,
          quantity: line.quantity, priceMinor: line.priceMinor.toString(), status: f.status } });
      return this.view(tx, tenantId, groupId, req);
    }, { userId: actor.userId });
  }

  /** SEND — refused while any line lacks its member's consent (CONSENT_MISSING names them); otherwise one linked response per line. */
  async send(tenantId: string, actor: RequirementActor, groupId: string, ip: string | null) {
    this.assertDesk(actor);
    return timed(this.metrics, 'requirements.group_send', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const { group, req } = await this.editable(tx, tenantId, groupId);
        const lines = (await this.repo.linesInTx(tx, tenantId, groupId)).filter((l) => l.status === 'active');
        if (lines.length === 0) throw new EmptyResponseGroupError();
        const missing: Array<{ userId: string; name: string | null; lineId: string }> = [];
        for (const l of lines) {
          const c = l.consentId ? await this.repo.consent(tx, tenantId, l.consentId) : null;
          const matches = !!c && c.act === 'quote' && c.memberUserId === l.sellerUserId && c.listingId === l.listingId && c.lineId === l.id
            && c.quantity !== null && parseQtyMilli(c.quantity) === parseQtyMilli(l.quantity) && c.priceMinor === l.priceMinor;
          if (!matches) missing.push({ userId: l.sellerUserId, name: shortName(l.sellerName), lineId: l.id });
        }
        if (missing.length > 0) throw new ConsentMissingError(missing);
        // the stock and the one-response-per-member rule, re-decided at the send
        for (const l of lines) await this.stockFor(tx, tenantId, req, l.listingId, l.quantity, l.sellerUserId);
        const already = await this.responses.sellersWithResponse(tx, tenantId, req.id, lines.map((l) => l.sellerUserId));
        if (already.length > 0) throw new DuplicateResponseError();
        assertGroupTransition(group.status, 'submitted');
        const now = new Date();
        const validUntil = new Date(now.getTime() + GROUP_VALID_MS);
        const written: Array<{ id: string; sellerUserId: string; quantity: string }> = [];
        for (const l of lines) {
          const resp = RequirementResponse.submit({ id: uuidv7(), requirementId: req.id, tenantId, sellerUserId: l.sellerUserId, listingId: l.listingId,
            quotedPriceMinor: l.priceMinor, quantity: l.quantity, validUntil, message: null, now, groupId, consentId: l.consentId, submittedBy: actor.userId });
          if (!(await this.responses.insert(tx, resp))) throw new DuplicateResponseError();
          await this.repo.markLineSent(tx, tenantId, l.id, resp.id);
          await this.flush(tx, tenantId, 'requirement_response', resp.id, resp.pullEvents());
          written.push({ id: resp.id, sellerUserId: l.sellerUserId, quantity: l.quantity });
        }
        await this.repo.markSent(tx, tenantId, groupId, actor.userId, now, validUntil);
        const g = (await this.repo.groupForUpdate(tx, tenantId, groupId))!;
        await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_sent', groupId, ip,
          oldValue: { status: group.status },
          newValue: { status: 'submitted', requirementId: req.id, responses: written, linkedResponses: written.length, totalQuantity: g.totalQuantity,
            blendedPriceMinor: g.blendedPriceMinor?.toString() ?? null, blendedRemainderMinor: g.blendedRemainderMinor.toString(), totalValueMinor: g.totalValueMinor.toString(),
            aboveCeiling: aboveCeiling(g.blendedPriceMinor, req.budgetMaxMinor), validUntil: validUntil.toISOString() } });
        await this.outbox.write(tx, { tenantId, aggregateType: 'requirement_response_group', aggregateId: groupId, eventType: GroupEventType.Quoted, payload: {
          v: 1, groupId, requirementId: req.id, reqNo: req.toProps().reqNo ?? null, title: req.toProps().title, recipientUserIds: [req.buyerUserId], buyerUserId: req.buyerUserId,
          members: written.length, totalQuantity: g.totalQuantity, unit: req.unitCode, responseIds: written.map((w) => w.id) } });
        return { ...(await this.view(tx, tenantId, groupId, req)), linkedResponses: written.length };
      }, { userId: actor.userId }));
  }

  /** The desk drops a draft, or withdraws a sent quote (its still-live responses lapse as rejected). Needs a reason. */
  async withdraw(tenantId: string, actor: RequirementActor, groupId: string, reason: string, ip: string | null) {
    this.assertDesk(actor);
    const why = cleanReason(reason);
    if (!why) throw new GroupLineInvalidError('REQUIREMENT_GROUP_REASON_REQUIRED', 'Withdrawing a pooled quote needs a reason (3–300 characters)');
    return this.uow.run(tenantId, async (tx) => {
      const group = await this.repo.groupForUpdate(tx, tenantId, groupId);
      if (!group) throw new ResponseGroupNotFoundError(groupId);
      assertGroupTransition(group.status, 'withdrawn');
      const req = await this.requirements.getForUpdate(tx, tenantId, group.requirementId);
      if (!req) throw new RequirementNotFoundError(group.requirementId);
      const lapsed: string[] = [];
      if (group.status === 'submitted') {
        for (const r of await this.responses.forGroupForUpdate(tx, tenantId, groupId)) {
          if (!isLive(r.status)) continue;
          r.reject(); await this.responses.update(tx, r); await this.flush(tx, tenantId, 'requirement_response', r.id, r.pullEvents()); lapsed.push(r.id);
        }
      }
      await this.repo.markWithdrawn(tx, tenantId, groupId, actor.userId, why);
      await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.group_withdrawn', groupId, ip, reason: why,
        oldValue: { status: group.status }, newValue: { status: 'withdrawn', responsesLapsed: lapsed } });
      await this.outbox.write(tx, { tenantId, aggregateType: 'requirement_response_group', aggregateId: groupId, eventType: GroupEventType.Withdrawn, payload: { v: 1, groupId, requirementId: req.id } });
      return this.view(tx, tenantId, groupId, req);
    }, { userId: actor.userId });
  }

  /** The pooled quotes on a requirement (the desk and moderators see them; the buyer sees a sent one through its responses). */
  async listFor(tenantId: string, actor: RequirementActor, requirementId: string) {
    const req = await this.requirements.getById(tenantId, requirementId);
    if (!req) throw new RequirementNotFoundError(requirementId);
    if (!actor.canDesk && !actor.canModerate && req.buyerUserId !== actor.userId) throw new RequirementDeskForbiddenError();
    const groups = await this.repo.groupsFor(tenantId, requirementId);
    const visible = req.buyerUserId === actor.userId && !actor.canDesk && !actor.canModerate ? groups.filter((g) => g.sentAt) : groups;
    const out: Array<ReturnType<ResponseGroupService['shape']>> = [];
    for (const g of visible) out.push(this.shape(g, await this.repo.lines(tenantId, g.id), req));
    return out;
  }
  async get(tenantId: string, actor: RequirementActor, groupId: string) {
    const g = await this.repo.group(tenantId, groupId);
    if (!g) throw new ResponseGroupNotFoundError(groupId);
    const req = await this.requirements.getById(tenantId, g.requirementId);
    if (!req) throw new RequirementNotFoundError(g.requirementId);
    const lines = await this.repo.lines(tenantId, groupId);
    const isMember = lines.some((l) => l.sellerUserId === actor.userId);
    if (!actor.canDesk && !actor.canModerate && !(req.buyerUserId === actor.userId && g.sentAt) && !isMember) throw new RequirementDeskForbiddenError();
    return this.shape(g, isMember && !actor.canDesk && !actor.canModerate ? lines.filter((l) => l.sellerUserId === actor.userId) : lines, req);
  }

  // ---- helpers ----
  private async editable(tx: TxContext, tenantId: string, groupId: string): Promise<{ group: GroupRow; req: Requirement }> {
    const group = await this.repo.groupForUpdate(tx, tenantId, groupId);
    if (!group) throw new ResponseGroupNotFoundError(groupId);
    if (!isEditable(group.status)) throw new ResponseGroupStateError(group.status, `The pooled quote is ${group.status} — it can no longer be changed`);
    const req = await this.requirements.getForUpdate(tx, tenantId, group.requirementId);
    if (!req) throw new RequirementNotFoundError(group.requirementId);
    if (!isAcceptingResponses(req.status)) throw new RequirementNotOpenError(req.status);
    return { group, req };
  }
  /** A1 — the line's listing: a tenant member's PUBLISHED listing (never the buyer's), in the requirement's unit, available ≥ quantity. */
  private async stockFor(tx: TxContext, tenantId: string, req: Requirement, listingId: string, quantity: string, expectSeller?: string) {
    if (!isQty(quantity) || parseQtyMilli(quantity) <= 0n) throw new GroupLineInvalidError('REQUIREMENT_LINE_QUANTITY_INVALID', 'Quantity must be a positive number (up to 3 decimals)');
    const l = await this.listings.stockForQuoteInTx(tx, tenantId, listingId);
    if (!l || l.status !== 'published') throw new GroupLineInvalidError('REQUIREMENT_LINE_LISTING_NOT_PUBLISHED', 'The listing is not published', { listingId });
    if (expectSeller && l.sellerUserId !== expectSeller) throw new GroupLineInvalidError('REQUIREMENT_LINE_LISTING_NOT_PUBLISHED', 'The listing changed hands', { listingId });
    if (l.sellerUserId === req.buyerUserId) throw new GroupLineInvalidError('REQUIREMENT_LINE_MEMBER_IS_BUYER', 'The buyer cannot fill their own requirement');
    if (!(await this.requirements.isActiveMember(tx, tenantId, l.sellerUserId))) throw new GroupLineInvalidError('REQUIREMENT_NOT_A_MEMBER', 'The listing\'s seller is not an active member of this tenant', { sellerUserId: l.sellerUserId });
    if (l.unitCode !== req.unitCode) throw new GroupLineInvalidError('REQUIREMENT_LINE_UNIT_MISMATCH', `The listing is sold per ${l.unitCode}; the buyer asked per ${req.unitCode}`, { listingUnit: l.unitCode, requirementUnit: req.unitCode });
    const avail = isQty(l.quantityAvailable) ? parseQtyMilli(l.quantityAvailable) : 0n;
    if (avail < parseQtyMilli(quantity)) throw new GroupLineInvalidError('REQUIREMENT_LINE_STOCK_SHORT', `Only ${formatQtyMilli(avail)} ${l.unitCode} available`, { available: formatQtyMilli(avail) });
    return l;
  }
  /** Recompute the draft's figures from its live lines (blended price in bigint, floor) and its draft status. */
  private async refigure(tx: TxContext, tenantId: string, group: GroupRow) {
    const lines = (await this.repo.linesInTx(tx, tenantId, group.id)).filter((l) => l.status === 'active');
    const b = blend(lines.map((l) => ({ qtyMilli: parseQtyMilli(l.quantity), priceMinor: l.priceMinor })));
    const status: GroupStatus = draftStatusFor(lines);
    assertGroupTransition(group.status, status);
    const f = { status, lineCount: b.lineCount, totalQuantity: formatQtyMilli(b.totalQtyMilli), totalValueMinor: b.totalValueMinor, blendedPriceMinor: b.blendedPriceMinor, blendedRemainderMinor: b.blendedRemainderMinor };
    await this.repo.saveFigures(tx, tenantId, group.id, f);
    return f;
  }
  private async view(tx: TxContext, tenantId: string, groupId: string, req: Requirement) {
    const g = (await this.repo.groupForUpdate(tx, tenantId, groupId))!;
    return this.shape(g, await this.repo.linesInTx(tx, tenantId, groupId), req);
  }
  private shape(g: GroupRow, lines: LineRow[], req: Requirement) {
    const ceiling = req.budgetMaxMinor;
    const remaining = parseQtyMilli(req.quantity) - parseQtyMilli(req.fulfilledQuantity);
    const total = parseQtyMilli(g.totalQuantity);
    return {
      id: g.id, requirementId: g.requirementId, status: g.status, createdBy: g.createdBy, createdAt: g.createdAt,
      lineCount: g.lineCount, totalQuantity: g.totalQuantity, unitCode: req.unitCode, totalValueMinor: g.totalValueMinor.toString(),
      blendedPriceMinor: g.blendedPriceMinor?.toString() ?? null, blendedRemainderMinor: g.blendedRemainderMinor.toString(),
      budgetMaxMinor: ceiling?.toString() ?? null, aboveCeiling: aboveCeiling(g.blendedPriceMinor, ceiling),
      fillsRequirement: total >= (remaining > 0n ? remaining : 0n) && total > 0n, remainingQuantity: formatQtyMilli(remaining > 0n ? remaining : 0n),
      validUntil: g.validUntil, sentAt: g.sentAt, decidedAt: g.decidedAt, withdrawReason: g.withdrawReason, validForHours: GROUP_VALID_MS / 3600_000,
      consentMissing: lines.filter((l) => l.status === 'active' && !l.consentId).map((l) => ({ lineId: l.id, sellerUserId: l.sellerUserId, sellerShortName: shortName(l.sellerName) })),
      lines: lines.map((l) => ({
        id: l.id, sellerUserId: l.sellerUserId, sellerShortName: shortName(l.sellerName), sellerPhoneMasked: l.sellerPhone ? maskPhone(l.sellerPhone) : null,
        listingId: l.listingId, listingTitle: l.listingTitle ?? null, quantity: l.quantity, priceMinor: l.priceMinor.toString(),
        valueMinor: lineValueMinor(parseQtyMilli(l.quantity), l.priceMinor).toString(), aboveCeiling: aboveCeiling(l.priceMinor, ceiling),
        status: l.status, responseId: l.responseId,
        consent: l.consentId ? { id: l.consentId, channel: l.consentChannel ?? null, recordedAt: l.consentRecordedAt ?? null, self: l.consentRecordedBy === l.sellerUserId } : null,
      })),
    };
  }
  private async flush(tx: TxContext, tenantId: string, aggregateType: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType, aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
