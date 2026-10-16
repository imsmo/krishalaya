// modules/communication/services/conversation.service.ts · open + manage chat threads.
// One ACID tx per write (UoW), outbox events in the SAME tx (Law 4), idempotent open (Law 3). Access is gated by
// PARTICIPANT membership resolved server-side — a non-participant read 404s (anti-IDOR). Locking needs an owner
// participant or message.moderate. The caller is ALWAYS added as a participant; client-supplied ids never grant
// the caller access to a thread they aren't in.
// PC-56 STORE-4b (founder D1 / D2c) — the BUYER opens the ORGANISATION thread (`openWithOrganisation`: the context validated in the caller's
// tenant, the organisation's side resolved by the server — every active `order.manage` member, oldest first, capped); the arbitrary-participant
// open is STAFF-only and every listed participant must hold a role here (`openGeneric`, the route's path — internal callers such as support and
// listings keep calling `open` directly); `scope=organisation` lists order + listing threads only; the lock is MONOTONIC (`setLock` → the
// entity's rule: the owner lifts only an owner lock); keyset cursors are µs (B4). Audited with `clientIpOf`: conversation.opened_with_organisation,
// conversation.locked / conversation.unlocked with the kind.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { encodeKeyset } from '../../../shared/pagination/us-keyset';
import { Conversation } from '../domain/conversation.entity';
import { DomainEvent, ContextType, MULTI_THREAD_CONTEXT_TYPES } from '../domain/messaging.events';
import { ConversationRepository } from '../repositories/conversation.repository';
import { OpenConversationDto } from '../dto/open-conversation.dto';
import { OpenOrganisationConversationDto } from '../dto/open-organisation-conversation.dto';
import {
  ConversationNotFoundError, MessagingForbiddenError, ConversationContextNotFoundError, ConversationNoResponderError, ConversationParticipantNotMemberError,
} from '../domain/messaging.errors';
import { viewerOf, buyerSummary, staffSummary, ConversationViewer } from '../domain/conversation-roles';
import { canUseGenericOpen, contextOwnerRule, respondersOf, RESPONDER_CAP, OrgContextType } from '../domain/organisation-thread';

/** The µs keyset cursor of a row (`created_at` as the database printed it + the id); null when the row carries no µs instant. */
const cursorOf = (createdAtUs: string | null | undefined, id: string): string | null => (createdAtUs ? encodeKeyset(createdAtUs, id) : null);

export interface MessagingActor { userId: string; isModerator: boolean; }

@Injectable()
export class ConversationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: ConversationRepository,
    // STORE-4b: appended (optional) so the unit harnesses' five-argument construction keeps working; Nest always injects it.
    @Optional() @Inject(AUDIT_WRITER) private readonly audit?: AuditWriter,
  ) {}

  /** PC-56 STORE-4b · D1 — THE ROUTE'S open (`POST /v1/conversations`): a STAFF tool. A caller with no organisation role here (a buyer) →
   *  403 MESSAGING_FORBIDDEN ("use the organisation thread"); every listed participant must hold an active role in this tenant → else 422
   *  CONVERSATION_PARTICIPANT_NOT_MEMBER. Internal callers (support's ticket thread, listings) call `open` directly and are unaffected. */
  async openGeneric(tenantId: string, actor: MessagingActor, idemKey: string, dto: OpenConversationDto) {
    if (!canUseGenericOpen(await this.viewer(tenantId, actor))) throw new MessagingForbiddenError('use the organisation thread');
    const others = [...new Set(dto.participantUserIds.filter((u) => u !== actor.userId))];
    if (others.length > 0) {
      const members = await this.uow.run(tenantId, (tx) => this.repo.tenantMemberIds(tx, tenantId, others), { userId: actor.userId });
      const outside = others.filter((u) => !members.has(u));
      if (outside.length > 0) throw new ConversationParticipantNotMemberError(outside.length);
    }
    return this.open(tenantId, actor, idemKey, dto);
  }

  /** PC-56 STORE-4b · D1 — a buyer's ONE thread with the ORGANISATION about an order (theirs) or a live listing. The context is validated in the
   *  caller's tenant (another buyer's order, or nothing → 404 CONVERSATION_CONTEXT_NOT_FOUND); an order thread is 1:1 by context (the caller
   *  must be in it), a listing thread is the caller's own; a new thread's other side is every active `order.manage` member (oldest first,
   *  ≤ 50; none → 422 CONVERSATION_NO_RESPONDER). Answers the caller's shape (a buyer reads the organisation's name, never a person). A member
   *  who joins the organisation AFTER the thread opened is not in it (a later wave resolves the organisation's side at read time). */
  async openWithOrganisation(tenantId: string, actor: MessagingActor, idemKey: string, dto: OpenOrganisationConversationDto, ip: string | null = null) {
    const contextType = dto.contextType as OrgContextType;
    const opened = await this.idem.remember(idemKey, actor.userId, 'comm.conversation.open_org', () =>
      timed(this.metrics, 'comm.conversation.open_org', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const found = contextType === 'order'
            ? await this.repo.orderBuyerOf(tx, tenantId, dto.contextId)
            : { exists: await this.repo.listingLive(tx, tenantId, dto.contextId), buyerUserId: null };
          if (!contextOwnerRule(contextType, found, actor.userId)) throw new ConversationContextNotFoundError();
          const existing = contextType === 'order'
            ? await this.repo.findByContext(tenantId, 'order', dto.contextId, tx)
            : await this.repo.findByContextForActor(tenantId, 'listing', dto.contextId, actor.userId, tx);
          if (existing) {
            if (!(await this.repo.isParticipant(tenantId, existing.id, actor.userId, tx))) throw new MessagingForbiddenError('not a participant of this context thread');
            return { id: existing.id, created: false };
          }
          const responders = respondersOf(await this.repo.orderManagersOf(tx, tenantId, RESPONDER_CAP), RESPONDER_CAP, actor.userId);
          if (responders.length === 0) throw new ConversationNoResponderError();
          const id = uuidv7();
          const convo = Conversation.open({ id, tenantId, contextType, contextId: dto.contextId });
          try {
            await this.repo.insert(tx, convo);
          } catch (e: any) {
            // a concurrent first open of the same ORDER lost on 0063's unique index: the tx is aborted — re-read the winner OFF-TX (the `open` precedent)
            if (e?.code === '23505' && contextType === 'order') {
              const winner = await this.repo.findByContext(tenantId, 'order', dto.contextId);
              if (winner && (await this.repo.isParticipant(tenantId, winner.id, actor.userId))) return { id: winner.id, created: false };
              throw new MessagingForbiddenError('not a participant of this context thread');
            }
            throw e;
          }
          await this.repo.addParticipants(tx, id, [{ userId: actor.userId, role: 'owner' }, ...responders.map((u) => ({ userId: u, role: 'member' as const }))]);
          await this.flush(tx, tenantId, id, convo.pullEvents());
          // the trail: who opened which context and how many answer — never a responder's name or id
          if (this.audit) await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'conversation.opened_with_organisation', entityType: 'conversation',
            entityId: id, newValue: { contextType, contextId: dto.contextId, responders: responders.length }, ip });
          return { id, created: true };
        }, { userId: actor.userId })));
    return this.getById(tenantId, actor, opened.id);
  }

  async open(tenantId: string, actor: MessagingActor, idemKey: string, dto: OpenConversationDto) {
    return this.idem.remember(idemKey, actor.userId, 'comm.conversation.open', () =>
      timed(this.metrics, 'comm.conversation.open', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          // Idempotent for GENUINELY 1:1 context-linked threads: reuse the single existing one (caller must
          // already belong to it). MULTI_THREAD_CONTEXT_TYPES ('direct', 'listing') skip this — several distinct
          // threads legitimately share the same (contextType, contextId) there (e.g. many buyers inquiring about
          // one listing), so the actor-scoped lookup below is used instead (never someone else's thread).
          if (!MULTI_THREAD_CONTEXT_TYPES.has(dto.contextType) && dto.contextId) {
            const existing = await this.repo.findByContext(tenantId, dto.contextType, dto.contextId, tx);
            if (existing) {
              if (!(await this.repo.isParticipant(tenantId, existing.id, actor.userId, tx))) throw new MessagingForbiddenError('not a participant of this context thread');
              return existing.toJSON();
            }
          } else if (dto.contextType === 'listing' && dto.contextId) {
            // Reuse THIS actor's own existing listing-inquiry thread (if any) instead of opening a duplicate
            // every time they tap "message seller" again — but never another buyer's thread for the same listing.
            const existing = await this.repo.findByContextForActor(tenantId, dto.contextType, dto.contextId, actor.userId, tx);
            if (existing) return existing.toJSON();
          }
          const id = uuidv7();
          const convo = Conversation.open({ id, tenantId, contextType: dto.contextType as ContextType, contextId: dto.contextId ?? null });
          try {
            await this.repo.insert(tx, convo);
          } catch (e: any) {
            // 0063: uq_conversations_context_1to1 backs the "one thread per (tenant, contextType,
            // contextId)" invariant this branch already assumed — a concurrent open() for the SAME
            // 1:1 context can lose the race between the findByContext read above and this insert.
            // Mirrors the 23505-on-unique-race handling in OnboardingService.grantRole: never surface
            // the race as an error, just re-fetch the row the other request just committed and hand
            // back THAT conversation instead (idempotent open, Law 3). Only reachable for genuinely
            // 1:1 context types — 'direct'/'listing' have no such constraint to race on.
            if (e?.code === '23505' && !MULTI_THREAD_CONTEXT_TYPES.has(dto.contextType) && dto.contextId) {
              // S4 REVIEW FIX: the 23505 aborted THIS transaction — any further query on `tx` throws
              // 25P02 ("current transaction is aborted"). Re-fetch the winner's row OFF-TX (replica/pool
              // read, same as the pre-insert lookup path), exactly like OnboardingService.grantRole
              // recovers outside the failed tx. The unique index 0063 guarantees the winner exists.
              const existing = await this.repo.findByContext(tenantId, dto.contextType, dto.contextId);
              if (existing) {
                if (!(await this.repo.isParticipant(tenantId, existing.id, actor.userId))) throw new MessagingForbiddenError('not a participant of this context thread');
                return existing.toJSON();
              }
            }
            throw e;
          }
          const others = [...new Set(dto.participantUserIds.filter((u) => u !== actor.userId))];
          await this.repo.addParticipants(tx, id, [{ userId: actor.userId, role: 'owner' }, ...others.map((u) => ({ userId: u, role: 'member' as const }))]);
          await this.flush(tx, tenantId, id, convo.pullEvents());
          return convo.toJSON();
        }, { userId: actor.userId })));
  }

  /** PC-56 HOTFIX-6 · B2: the viewer's shape on THIS tenant — staff (a moderator, or an organisation role read from the database) or a buyer. */
  async viewer(tenantId: string, actor: MessagingActor): Promise<ConversationViewer> {
    if (actor.isModerator) return 'staff';
    return viewerOf({ isModerator: false, isOrgMember: (await this.repo.orgMemberIds(tenantId, [actor.userId])).has(actor.userId) });
  }
  async getById(tenantId: string, actor: MessagingActor, id: string) {
    const c = await this.repo.getForParticipant(tenantId, actor.userId, id);
    if (!c) throw new ConversationNotFoundError(id);   // 404 for a non-participant (no IDOR)
    // PC-56 HOTFIX-6 · B2: the thread names its other side — the buyer reads the ORGANISATION (never a person), the context label (the order
    // number); staff keep the full summary. A moderator reading a thread they are not in gets the bare conversation, as before.
    const summary = await this.repo.summaryForParticipant(tenantId, actor.userId, id);
    if (!summary) return c.toJSON();
    return (await this.viewer(tenantId, actor)) === 'buyer' ? buyerSummary(summary) : staffSummary(summary);
  }
  async list(tenantId: string, actor: MessagingActor, q: { contextType?: string; contextId?: string; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.repo.listForUser(tenantId, actor.userId, q);
    const items = rows.map((r) => r.convo.toJSON());
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? cursorOf(last.createdAtUs, last.convo.id) : null;   // µs (STORE-4b · B4)
    return { items, nextCursor };
  }
  /** The caller's inbox as enriched summaries (contract-gap P0-1). Keyset (created_at|id), same cursor grammar as
   * list(). `archived` splits inbox from archive. Membership is enforced by the JOIN in the read — a non-participant
   * simply never appears (no IDOR). */
  async listSummaries(tenantId: string, actor: MessagingActor, q: { archived: boolean; contextType?: string; contextId?: string; cursor?: { c: string; id: string }; limit: number; scope?: 'organisation' }, opts: { asStaff?: true } = {}) {
    const rows = await this.repo.listSummariesForUser(tenantId, actor.userId, q);
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? cursorOf(last.createdAtUs, last.id) : null;   // µs (STORE-4b · B4)
    // PC-56 HOTFIX-6 · B2 (survey F-2): a buyer's inbox carries the organisation's name and a party label — never users.full_name, never a
    // person's uuid; staff keep both (KV-BL-031's listings inquiries read `counterpartyUserId` as the seller).
    // `asStaff` is a SERVER decision only (listings' owner-verified inquiries read, KV-BL-031) — never from a request.
    if (opts.asStaff || (await this.viewer(tenantId, actor)) === 'staff') return { items: rows.map((r) => staffSummary(r)), nextCursor, shape: 'staff' as const };
    return { items: rows.map((r) => buyerSummary(r)), nextCursor, shape: 'buyer' as const };
  }
  /** Archive/restore the thread FOR THE CALLER only (per-participant). Re-checks membership (anti-IDOR) then flips
   * the flag idempotently — no outbox event (this is private UI state, not a shared thread change). */
  async setArchive(tenantId: string, actor: MessagingActor, id: string, archived: boolean) {
    return this.uow.run(tenantId, async (tx) => {
      if (!(await this.repo.isParticipant(tenantId, id, actor.userId, tx))) throw new ConversationNotFoundError(id);
      await this.repo.setArchived(tx, id, actor.userId, archived);
      return { ok: true, isArchived: archived };
    }, { userId: actor.userId });
  }
  async markRead(tenantId: string, actor: MessagingActor, id: string) {
    return this.uow.run(tenantId, async (tx) => {
      if (!(await this.repo.isParticipant(tenantId, id, actor.userId, tx))) throw new ConversationNotFoundError(id);
      await this.repo.markRead(tx, id, actor.userId);
      return { ok: true };
    }, { userId: actor.userId });
  }
  /** PC-56 STORE-4b · D2c: lock as `owner` (the opener) or `moderator`; lift by the entity's rule — the owner lifts only an owner lock
   *  (403 CONVERSATION_LOCK_HELD otherwise), a moderator lifts any. A no-op (already so) writes nothing and audits nothing. */
  async setLock(tenantId: string, actor: MessagingActor, id: string, locked: boolean, ip: string | null = null) {
    return this.uow.run(tenantId, async (tx) => {
      const convo = await this.repo.getForUpdate(tx, tenantId, id);
      if (!convo) throw new ConversationNotFoundError(id);
      const role = await this.repo.participantRole(tenantId, id, actor.userId, tx);
      if (role === null && !actor.isModerator) throw new ConversationNotFoundError(id);     // not a participant ⇒ 404
      if (role !== 'owner' && !actor.isModerator) throw new MessagingForbiddenError('only the owner or a moderator may lock this thread');
      const by = actor.isModerator ? 'moderator' as const : 'owner' as const;
      const was = convo.lockKind;
      const changed = locked ? convo.lock(by) : convo.unlock(by);
      if (changed) {
        await this.repo.update(tx, convo);
        await this.flush(tx, tenantId, id, convo.pullEvents());
        if (this.audit) await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: locked ? 'conversation.locked' : 'conversation.unlocked',
          entityType: 'conversation', entityId: id, oldValue: { lockKind: was }, newValue: { lockKind: convo.lockKind, by }, ip });
      }
      return convo.toJSON();
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'conversation', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
