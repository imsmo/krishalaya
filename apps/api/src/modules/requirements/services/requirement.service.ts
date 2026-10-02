// modules/requirements/services/requirement.service.ts
// Requirement (demand-post) use-cases. Every write: one ACID tx (UoW), status via the machine
// (Law 5), outbox events in the SAME tx (Law 4). NO money moves here. No version column → mutations lock the row FOR UPDATE.
//
// PC-56 TENANT-11d:
//   • A3 (F-8 / F-20) — the buyer desk (`requirement.desk`) posts AS a named buyer: the buyer must be an active member, the
//     buyer's recorded consent (`requirement_consents` act=post) is written in the same transaction, `posted_by` names the desk
//     user, and the buyer is the named member — never the desk. A buyer posting for themself still needs `requirement.post`.
//   • A7 (F-24) — create, update and close are audited with actor · reason · before/after · ip, the buyer's and a moderator's
//     alike; a moderator close needs a reason. The board is a µs keyset with `box=open` honouring `status`, `box=all` for the
//     desk, the "Need by ▴" sort and per-status counts; every row carries the real response count and the buyer's short name.
//   • F-1 — expiry and the need-by reminder run per tenant through kv_app's unit of work (jobs/requirements.cadence-jobs.ts).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Requirement } from '../domain/requirement.entity';
import { DomainEvent, RequirementEventType } from '../domain/requirements.events';
import { isAcceptingResponses } from '../domain/requirement.state';
import { Cursor, encodeCursor } from '../domain/cursor';
import { cleanReason, maskPhone, shortName } from '../domain/display';
import {
  RequirementNotFoundError, RequirementForbiddenError, RequirementDeskForbiddenError, BuyerConsentRequiredError, NotATenantMemberError, CloseReasonRequiredError,
} from '../domain/requirements.errors';
import { ReqFacts, ReqRow, RequirementRepository } from '../repositories/requirement.repository';
import { ResponseGroupRepository } from '../repositories/response-group.repository';
import { CreateRequirementDto } from '../dto/create-requirement.dto';
import { UpdateRequirementDto } from '../dto/update-requirement.dto';
import { RequirementActor, seesAll } from '../policies/requirements.policies';

export type { RequirementActor } from '../policies/requirements.policies';

/** A `date` column: node-pg reads it as LOCAL midnight; a DTO day is built as local midnight too, so the local getters always
 *  give back the day that was written ('YYYY-MM-DD', never shifted by a UTC conversion). */
export function localDay(day: string | null | undefined): Date | null {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function dayText(d: Date | null | undefined): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Injectable()
export class RequirementService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: RequirementRepository,
    private readonly groups: ResponseGroupRepository,
  ) {}

  private audited(tx: TxContext, e: { tenantId: string; actorUserId: string | null; action: string; id: string; oldValue?: unknown; newValue?: unknown; reason?: string | null; ip: string | null }) {
    return this.audit.write(tx, { tenantId: e.tenantId, actorUserId: e.actorUserId, action: e.action, entityType: 'requirement', entityId: e.id,
      oldValue: e.oldValue ?? null, newValue: e.newValue ?? null, reason: e.reason ?? null, ip: e.ip });
  }

  /** Post a requirement — as oneself (`requirement.post`), or AS a named buyer (`requirement.desk` + the buyer's consent). */
  async create(tenantId: string, actor: RequirementActor | string, idemKey: string, dto: CreateRequirementDto, ip: string | null = null) {
    const a: RequirementActor = typeof actor === 'string' ? { userId: actor, canModerate: false, canPost: true } : actor;
    const onBehalf = dto.onBehalf && dto.onBehalf.buyerUserId !== a.userId ? dto.onBehalf : null;
    if (onBehalf && !a.canDesk) throw new RequirementDeskForbiddenError('posting for a buyer needs the buyer desk (requirement.desk)');
    if (!onBehalf && a.canPost === false) throw new RequirementForbiddenError('posting your own requirement needs requirement.post');
    // `app` is only ever the buyer themself; a voice / written yes carries its evidence media (the DTO checks it too — this is the wall)
    if (onBehalf && (onBehalf.consent.channel === 'app' || (onBehalf.consent.channel !== 'otp' && !onBehalf.consent.mediaId))) throw new BuyerConsentRequiredError('post', 'REQUIREMENT_CONSENT_EVIDENCE_REQUIRED');
    const buyerUserId = onBehalf ? onBehalf.buyerUserId : a.userId;
    return this.idem.remember(idemKey, a.userId, 'requirements.post', () =>
      timed(this.metrics, 'requirements.post', { tenant: tenantId }, async () => {
        const consentId = onBehalf ? uuidv7() : null;
        const requirement = Requirement.post({
          id: uuidv7(), tenantId, buyerUserId, productId: dto.productId ?? null, categoryId: dto.categoryId ?? null,
          title: dto.title, quantity: dto.quantity, unitCode: dto.unitCode,
          budgetMinMinor: dto.budgetMinMinor ? BigInt(dto.budgetMinMinor) : null, budgetMaxMinor: dto.budgetMaxMinor ? BigInt(dto.budgetMaxMinor) : null,
          currencyCode: dto.currencyCode ?? 'INR', needBy: localDay(dto.needBy),
          deliveryPincode: dto.deliveryPincode ?? null, isUrgent: dto.isUrgent ?? false,
          postedBy: onBehalf ? a.userId : null, postConsentId: consentId,
        });
        return this.uow.run(tenantId, async (tx) => {
          if (onBehalf && !(await this.repo.isActiveMember(tx, tenantId, buyerUserId))) throw new NotATenantMemberError(buyerUserId, 'buyer');
          const reqNo = await this.repo.insert(tx, requirement);
          const p = requirement.toProps();
          if (onBehalf && consentId) {
            await this.groups.insertConsent(tx, { id: consentId, tenantId, requirementId: p.id, act: 'post', memberUserId: buyerUserId,
              channel: onBehalf.consent.channel, mediaId: onBehalf.consent.mediaId ?? null, note: onBehalf.consent.note?.trim() || null, recordedBy: a.userId });
          }
          await this.audited(tx, { tenantId, actorUserId: a.userId, action: 'requirement.created', id: p.id, ip,
            newValue: { reqNo, title: p.title, quantity: p.quantity, unitCode: p.unitCode, budgetMinMinor: p.budgetMinMinor?.toString() ?? null,
              budgetMaxMinor: p.budgetMaxMinor?.toString() ?? null, needBy: dto.needBy ?? null, deliveryPincode: p.deliveryPincode, isUrgent: p.isUrgent,
              buyerUserId, onBehalf: !!onBehalf, consentId, consentChannel: onBehalf?.consent.channel ?? null } });
          await this.flush(tx, tenantId, p.id, requirement.pullEvents());
          return { ...this.serialize(p), reqNo };
        }, { userId: a.userId });
      }));
  }

  /** The buyer edits their requirement while it solicits quotes (or a moderator does — with a reason). Audited before/after. */
  async update(tenantId: string, actor: RequirementActor, id: string, dto: UpdateRequirementDto, ip: string | null, reason?: string | null) {
    return timed(this.metrics, 'requirements.update', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const r = await this.repo.getForUpdate(tx, tenantId, id);
        if (!r) throw new RequirementNotFoundError(id);
        const asModerator = r.buyerUserId !== actor.userId;
        if (asModerator && !actor.canModerate) throw new RequirementForbiddenError('only the buyer may modify this requirement');
        const before = this.serialize(r.toProps());
        r.editDetails({
          title: dto.title, quantity: dto.quantity, unitCode: dto.unitCode,
          productId: dto.productId === undefined ? undefined : (dto.productId ?? null),
          categoryId: dto.categoryId === undefined ? undefined : (dto.categoryId ?? null),
          budgetMinMinor: dto.budgetMinMinor === undefined ? undefined : (dto.budgetMinMinor == null ? null : BigInt(dto.budgetMinMinor)),
          budgetMaxMinor: dto.budgetMaxMinor === undefined ? undefined : (dto.budgetMaxMinor == null ? null : BigInt(dto.budgetMaxMinor)),
          needBy: dto.needBy === undefined ? undefined : localDay(dto.needBy),
          deliveryPincode: dto.deliveryPincode === undefined ? undefined : (dto.deliveryPincode ?? null),
          isUrgent: dto.isUrgent,
        });
        await this.repo.update(tx, r);
        const after = this.serialize(r.toProps());
        const changed = Object.keys(dto) as Array<keyof typeof before>;
        const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, o[k as string] ?? null]));
        await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.edited', id, ip, reason: cleanReason(reason),
          oldValue: pick(before as never), newValue: { ...pick(after as never), by: asModerator ? 'moderator' : 'buyer' } });
        await this.flush(tx, tenantId, id, r.pullEvents());
        return after;
      }, { userId: actor.userId }));
  }

  /** The buyer withdraws their requirement, or a moderator closes it WITH a reason (A4 / A7). Audited either way. */
  async close(tenantId: string, actor: RequirementActor, id: string, ip: string | null, reason?: string | null) {
    return timed(this.metrics, 'requirements.close', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const r = await this.repo.getForUpdate(tx, tenantId, id);
        if (!r) throw new RequirementNotFoundError(id);
        const isBuyer = r.buyerUserId === actor.userId;
        if (!isBuyer && !actor.canModerate) throw new RequirementForbiddenError('only the buyer or a moderator may close this requirement');
        const why = cleanReason(reason);
        if (!isBuyer && !why) throw new CloseReasonRequiredError();
        const from = r.status;
        r.close(actor.userId, why);
        await this.repo.update(tx, r);
        await this.audited(tx, { tenantId, actorUserId: actor.userId, action: 'requirement.closed', id, ip, reason: why,
          oldValue: { status: from }, newValue: { status: 'closed', by: isBuyer ? 'buyer' : 'moderator', fulfilledQuantity: r.fulfilledQuantity } });
        await this.flush(tx, tenantId, id, r.pullEvents());
        return this.serialize(r.toProps());
      }, { userId: actor.userId }));
  }

  /** Expiry (the cadence sweep's act): lapse a requirement past need_by (India day). Re-locks and re-checks; audited (actor NULL). */
  async expire(tenantId: string, id: string, now: Date = new Date()): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.getForUpdate(tx, tenantId, id);
      if (!r || !isAcceptingResponses(r.status)) return false;
      if (!(await this.repo.isPastNeedBy(tx, tenantId, id, now))) return false;      // the India calendar day, decided in SQL
      const from = r.status;
      r.expire();
      await this.repo.update(tx, r);
      await this.audited(tx, { tenantId, actorUserId: null, action: 'requirement.expired', id, ip: null, reason: 'need-by date passed',
        oldValue: { status: from }, newValue: { status: 'expired', needBy: dayText(r.needBy), fulfilledQuantity: r.fulfilledQuantity } });
      await this.flush(tx, tenantId, id, r.pullEvents());
      return true;
    }, { userId: 'system' });
  }

  /** The need-by reminder (the cadence sweep's act, per tenant): one reminder per OPEN requirement within the horizon, stamped. */
  async remindDue(tenantId: string, now: Date, horizonDays: number, limit: number): Promise<number> {
    return this.uow.run(tenantId, async (tx) => {
      const due = await this.repo.dueForReminder(tx, tenantId, now, new Date(now.getTime() + horizonDays * 86_400_000), limit);
      for (const r of due) {
        await this.outbox.write(tx, { tenantId, aggregateType: 'requirement', aggregateId: r.id, eventType: RequirementEventType.ReminderDue,
          payload: { v: 1, requirementId: r.id, buyerUserId: r.buyerUserId, reqNo: r.reqNo } });
      }
      await this.repo.markReminded(tx, tenantId, due.map((d) => d.id));
      return due.length;
    }, { userId: 'system' });
  }

  async getById(tenantId: string, id: string, actor?: RequirementActor) {
    const r = await this.repo.getById(tenantId, id);   // requirements are public WITHIN the tenant (sellers browse to quote)
    if (!r) throw new RequirementNotFoundError(id);
    const facts = (await this.repo.factsFor(tenantId, [id])).get(id);
    const isBuyer = !!actor && actor.userId === r.buyerUserId;
    // what THIS viewer may do here — the console offers only these; the API re-decides every act
    const viewer = actor ? { isBuyer, canDesk: !!actor.canDesk, canModerate: actor.canModerate, canQuote: !!actor.canQuote && !isBuyer,
      decidesAsBuyer: isBuyer, decidesForBuyerWithConsent: !isBuyer && !!actor.canDesk, canClose: isBuyer || actor.canModerate, closeNeedsReason: !isBuyer } : null;
    return { ...this.serialize(r.toProps()), ...this.factsView(facts, actor ? (seesAll(actor) || isBuyer) : false), viewer };
  }

  /** The board (A7). `box=all` (every requirement in the tenant) is the desk's / a moderator's; `counts` adds per-status counts. */
  async list(tenantId: string, actor: RequirementActor, q: { box: 'open' | 'mine' | 'all'; status?: string; categoryId?: string; sort?: 'recent' | 'need_by'; counts?: boolean; cursor?: Cursor; limit: number }) {
    if (q.box === 'all' && !seesAll(actor)) throw new RequirementDeskForbiddenError('the whole board is the buyer desk\'s (requirement.desk) or a moderator\'s');
    const sort = q.sort ?? 'recent';
    const rows: ReqRow[] = await this.repo.list(tenantId, { box: q.box, buyerUserId: actor.userId, status: q.status, categoryId: q.categoryId, sort, cursor: q.cursor, limit: q.limit });
    const facts = await this.repo.factsFor(tenantId, rows.map((x) => x.entity.id));
    const items = rows.map((x) => ({ ...this.serialize(x.entity.toProps()), ...this.factsView(facts.get(x.entity.id), seesAll(actor) || x.entity.buyerUserId === actor.userId) }));
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? (sort === 'need_by' ? encodeCursor('need_by', last.needByRaw, last.entity.id) : encodeCursor('created', last.createdAtRaw, last.entity.id)) : null;
    const counts = q.counts ? await this.repo.countByStatus(tenantId, { box: q.box, buyerUserId: actor.userId, categoryId: q.categoryId }) : null;
    const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : null;
    return { items, nextCursor, counts, total };
  }

  /** Names on a row: the buyer's SHORT name always (W131 "Buyer"); the masked phone only to the buyer, the desk and moderators. */
  private factsView(f: ReqFacts | undefined, full: boolean) {
    return {
      responsesCount: f?.responsesCount ?? 0,
      buyerShortName: shortName(f?.buyerName),
      buyerPhoneMasked: full && f?.buyerPhone ? maskPhone(f.buyerPhone) : null,
      buyerOrganisation: null as string | null,     // no organisation name is recorded for a buyer on the platform (named on screen)
      postedByShortName: f?.postedByName ? shortName(f.postedByName) : null,
      productName: f?.productName ?? null,
    };
  }
  private serialize(p: ReturnType<Requirement['toProps']>) {
    return { id: p.id, reqNo: p.reqNo ?? null, buyerUserId: p.buyerUserId, productId: p.productId, categoryId: p.categoryId, title: p.title,
      quantity: p.quantity, fulfilledQuantity: p.fulfilledQuantity ?? '0.000', unitCode: p.unitCode,
      budgetMinMinor: p.budgetMinMinor?.toString() ?? null, budgetMaxMinor: p.budgetMaxMinor?.toString() ?? null,
      currencyCode: p.currencyCode, needBy: dayText(p.needBy), deliveryPincode: p.deliveryPincode, status: p.status, isUrgent: p.isUrgent, createdAt: p.createdAt,
      postedBy: p.postedBy ?? null, onBehalf: !!p.postedBy, closedAt: p.closedAt ?? null, closeReason: p.closeReason ?? null };
  }
  private async flush(tx: TxContext, tenantId: string, requirementId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'requirement', aggregateId: requirementId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
