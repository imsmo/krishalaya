// apps/admin-api/src/modules/moderation-queue/services/listing-moderation.service.ts · W090 + W091 (ADMIN-5f).
//
// The service that makes "removed" mean removed. Before this, handling a report as `removed` wrote a status column,
// emitted an event nothing consumed, and left the listing published and purchasable.
//
// EVERY WRITE IS ONE TRANSACTION containing the listing change, the order record, the notices owed and the audit row
// (Law 4). The notices are `queued` in that transaction and settled later by the apps/api executor — so a crash
// between the hold and the notice cannot leave a farmer's listing stopped with nothing telling them why.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { isSecondPerson } from '../../../core/approval/two-person-rule';
import { ModerationQueueRepository, type HeldListingRow } from '../repositories/moderation-queue.repository';
import {
  valueAtStakeMinor, holdSla, holdDeadline, assertHoldable, assertReleasable, assertRemovable, removeState,
  assertReason, assertLanguage, noticesFor, removalNeedsChecker, APPEAL_PATH, HOLD_SLA_HOURS,
  REMOVAL_CHECKER_THRESHOLD_MINOR, LISTING_STATE_SOURCE, type HoldSource,
} from '../domain/listing-hold';
import { ModerationSubjectNotFoundError } from '../domain/moderation-queue.errors';
import type { HoldDto, ReleaseDto, RemoveDto } from '../dto/moderation-queue.dto';

/** W091's risk event on removal. −40, `fake_listing`, exactly as the confirm dialog states. */
const REMOVAL_RISK_EVENT = Object.freeze({ code: 'fake_listing', weight: -40 });

@Injectable()
export class ListingModerationService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: ModerationQueueRepository,
  ) {}

  /** Value at stake, computed from the row rather than trusted from the client. The client showing one figure and the
   *  server judging the maker-checker threshold against another is the whole reason this is not a request field. */
  private value(l: HeldListingRow): bigint {
    return valueAtStakeMinor(BigInt(l.priceMinor), l.quantityAvailable);
  }

  private view(l: HeldListingRow, now: Date, viewer: string | null) {
    const v = this.value(l);
    return {
      id: l.id, tenantId: l.tenantId, title: l.title, status: l.status,
      priceMinor: l.priceMinor, quantityAvailable: l.quantityAvailable, unitCode: l.unitCode,
      sellerUserId: l.sellerUserId,
      heldAt: l.heldAt, holdSlaDueAt: l.holdSlaDueAt,
      sla: holdSla(l.holdSlaDueAt, now),
      holdReason: l.holdReason, holdSource: l.holdSource, holdActorAdminId: l.holdActorAdminId,
      // Recomputed AND the figure recorded at decision time, both. They should agree; when they do not, the listing
      // has been edited since the hold, which is itself something an operator should see before removing it.
      valueAtStakeMinor: v.toString(),
      valueAtHoldMinor: l.valueAtStakeMinor,
      removalNeedsChecker: removalNeedsChecker(v),
      removeState: removeState(l.heldAt, v, null),
      // MAKER-CHECKER BY ABSENCE: the console draws Remove only when a second operator is looking.
      removeOfferable: !!l.heldAt && (!removalNeedsChecker(v) || isSecondPerson(l.holdActorAdminId, viewer)),
      thresholdMinor: REMOVAL_CHECKER_THRESHOLD_MINOR.toString(),
      slaHours: HOLD_SLA_HOURS,
    };
  }

  async queue(q: { cursor?: { d: string; id: string }; limit: number }, viewer: string | null) {
    const now = new Date();
    const rows = await this.repo.listHeld({ cursor: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((l) => this.view(l, now, viewer)),
      nextCursor: rows.length > q.limit && last && last.holdSlaDueAt
        ? Buffer.from(`${last.holdSlaDueAt}|${last.id}`).toString('base64') : null,
      stateSource: LISTING_STATE_SOURCE,
    };
  }

  async get(id: string, viewer: string | null) {
    const l = await this.repo.getListing(id);
    if (!l) throw new ModerationSubjectNotFoundError('no such listing');
    const orders = await this.repo.ordersFor(id, 50);
    const notices = l.holdOrderId ? await this.repo.noticesForOrder(l.holdOrderId) : [];
    return { ...this.view(l, new Date(), viewer), orders, notices };
  }

  /** HOLD — one operator, immediate. W089: "hold fast". */
  async hold(actor: AdminRequestContext, id: string, dto: HoldDto) {
    const langs = await this.repo.activeLanguages();
    return this.pool.withTx(async (c) => {
      const l = await this.repo.getListingForUpdate(c, id);
      if (!l) throw new ModerationSubjectNotFoundError('no such listing');
      assertHoldable(l.status, l.heldAt);
      const reason = assertReason(dto.reason);
      const language = assertLanguage(dto.languageCode, langs);
      const value = this.value(l);
      const now = new Date();
      const due = holdDeadline(now);

      const orderId = await this.repo.insertOrder(c, {
        tenantId: l.tenantId, listingId: id, action: 'hold', source: dto.source as HoldSource,
        sourceRef: dto.sourceRef ?? null, reason, valueAtStakeMinor: value, actorAdminId: actor.userId,
      });
      await this.repo.applyHold(c, id, orderId, due, actor.userId);
      await this.queueNotices(c, {
        action: 'hold', tenantId: l.tenantId, orderId, sellerUserId: l.sellerUserId, reporterUserId: null,
        // W091: "farmer sees 'under review' honestly — with ETA". The ETA is the real deadline, not "shortly" —
        // "shortly" on perishable produce is not information.
        body: `${reason}\n\nYour listing is under review until ${due.toISOString()}.`,
        language,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'moderation.listing_held', entityType: 'listing', entityId: id,
        oldValue: { status: l.status },
        newValue: { status: 'held', orderId, valueAtStakeMinor: value.toString(), holdSlaDueAt: due.toISOString(), source: dto.source },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, orderId, holdSlaDueAt: due.toISOString(), valueAtStakeMinor: value.toString() };
    });
  }

  /** RELEASE — the ordinary outcome. Most holds are wrong by design, which is the point of holding rather than
   *  removing, so releasing is deliberately the cheapest path on this screen. */
  async release(actor: AdminRequestContext, id: string, dto: ReleaseDto) {
    const langs = await this.repo.activeLanguages();
    return this.pool.withTx(async (c) => {
      const l = await this.repo.getListingForUpdate(c, id);
      if (!l) throw new ModerationSubjectNotFoundError('no such listing');
      assertReleasable(l.heldAt);
      const reason = assertReason(dto.reason);
      const language = assertLanguage(dto.languageCode, langs);
      const orderId = await this.repo.insertOrder(c, {
        tenantId: l.tenantId, listingId: id, action: 'release', source: (dto.source ?? 'spot_audit') as HoldSource,
        sourceRef: dto.sourceRef ?? null, reason, valueAtStakeMinor: this.value(l), actorAdminId: actor.userId,
      });
      await this.repo.applyRelease(c, id, actor.userId);
      await this.queueNotices(c, {
        action: 'release', tenantId: l.tenantId, orderId, sellerUserId: l.sellerUserId,
        reporterUserId: dto.reporterUserId ?? null,
        body: `${reason}\n\nYour listing is live again.`,
        language,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'moderation.listing_released', entityType: 'listing', entityId: id,
        oldValue: { status: l.status }, newValue: { status: 'published', orderId },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, orderId };
    });
  }

  /**
   * REMOVE — irreversible, and the platform's NINTH maker-checker site above ₹1,00,000.
   *
   * A removal may only happen FROM A HOLD. That ordering is "remove slow" made structural: to remove a listing an
   * operator must first hold it, which means the seller has already been told it is under review and has had the
   * chance to respond. A remove button on a live listing would let one click end a farmer's sale with no interval.
   */
  async remove(actor: AdminRequestContext, id: string, dto: RemoveDto) {
    const langs = await this.repo.activeLanguages();
    return this.pool.withTx(async (c) => {
      const l = await this.repo.getListingForUpdate(c, id);
      if (!l) throw new ModerationSubjectNotFoundError('no such listing');
      // The hold's ORIGINAL actor, read from the order rather than from the listing, because that is the person the
      // second-signature rule is about.
      const orders = await this.repo.ordersFor(id, 5);
      const holdActor: string | null = orders.find((o) => o.action === 'hold')?.actorAdminId ?? null;
      const value = this.value(l);
      const reason = assertReason(dto.reason);
      const language = assertLanguage(dto.languageCode, langs);
      const { needsChecker } = assertRemovable({
        alreadyHeldAt: l.heldAt, valueMinor: value, actor: actor.userId, heldBy: holdActor,
        checker: needsCheckerCandidate(value, actor.userId),
      });

      const orderId = await this.repo.insertOrder(c, {
        tenantId: l.tenantId, listingId: id, action: 'remove', source: (dto.source ?? 'spot_audit') as HoldSource,
        sourceRef: dto.sourceRef ?? null, reason, valueAtStakeMinor: value, actorAdminId: holdActor ?? actor.userId,
        // The DB constraint `ck_lmo_removal_checked` refuses a high-value removal with no checker, and
        // `ck_lmo_maker_ne_checker` refuses the overlap. Both are belt to the domain's braces.
        checkerAdminId: needsChecker ? actor.userId : null,
        checkerNote: needsChecker ? (dto.checkerNote ?? reason) : null,
      });
      await this.repo.applyRemoval(c, id, actor.userId);

      // W091's confirm dialog, honoured literally: "logs a risk_event (fake_listing, weight −40) against the seller".
      // On REMOVE only — 0112's closing note explains why a hold does not score somebody down.
      if (l.sellerUserId) {
        await this.repo.recordRiskEvent(c, {
          tenantId: l.tenantId, userId: l.sellerUserId,
          eventCode: REMOVAL_RISK_EVENT.code, weight: REMOVAL_RISK_EVENT.weight, referenceId: orderId,
        });
      }

      await this.queueNotices(c, {
        action: 'remove', tenantId: l.tenantId, orderId, sellerUserId: l.sellerUserId,
        reporterUserId: dto.reporterUserId ?? null,
        body: `${reason}\n\nYour listing has been removed. You can appeal this decision.`,
        language,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'moderation.listing_removed', entityType: 'listing', entityId: id,
        oldValue: { status: l.status },
        newValue: {
          status: 'archived', orderId, valueAtStakeMinor: value.toString(), needsChecker,
          heldBy: holdActor, riskEvent: l.sellerUserId ? REMOVAL_RISK_EVENT : null,
        },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, orderId, needsChecker, valueAtStakeMinor: value.toString() };
    });
  }

  /** The notices an order owes, composed from the ACTION so none can be silently skipped. */
  private async queueNotices(c: Parameters<ModerationQueueRepository['queueNotice']>[0], v: {
    action: 'hold' | 'release' | 'remove'; tenantId: string; orderId: string;
    sellerUserId: string | null; reporterUserId: string | null; body: string; language: string;
  }): Promise<void> {
    for (const kind of noticesFor(v.action, !!v.reporterUserId)) {
      await this.repo.queueNotice(c, {
        tenantId: v.tenantId, orderId: v.orderId, recipientKind: kind,
        recipientUserId: kind === 'subject_owner' ? v.sellerUserId : v.reporterUserId,
        body: v.body, languageCode: v.language, appealPath: APPEAL_PATH,
        // One key per (order, recipient kind), so a retried write cannot queue the same notice twice.
        idempotencyKey: `modnotice:${v.orderId}:${kind}`,
      });
    }
  }
}

/** The checker on a high-value removal is the ACTOR performing it, and only when one is required.
 *
 *  Written as a named function rather than inlined because the alternative reads as though the caller could nominate
 *  somebody else — which would let one operator name an absent colleague as the checker.
 */
function needsCheckerCandidate(value: bigint, actorId: string): string | null {
  return removalNeedsChecker(value) ? actorId : null;
}
