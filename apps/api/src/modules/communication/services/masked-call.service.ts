// modules/communication/services/masked-call.service.ts · privacy-proxy calling (PRD §9.13).
// initiate: bridge the two users via the EXTERNAL masking provider (resilience-wrapped, OUTSIDE the tx — no
// network in a DB transaction), then record the log row (user ids + provider ref ONLY; never raw phones).
// Idempotent per (user, endpoint). A provider failure degrades to a typed 503 (caller retries) — nothing is
// recorded. complete() is driven by the provider's call-status webhook (idempotent). Reads are own-log only.
//
// PC-56 HOTFIX-6 · B1 (survey STORE-4 F-1, founder D2) — THE CALLEE IS THE SERVER'S DECISION. It used to bridge ANY `calleeUserId` the client
// sent (users are global: anyone on the platform), with no participant, tenant or block check. Now, BEFORE any network call, in one read
// transaction: the conversation is loaded in the caller's tenant; the caller must be a participant (else 403 MASKED_CALL_NOT_PARTICIPANT —
// an unknown conversation answers the same); the callee is the ONE other participant (`domain/conversation-roles.ts` resolveCallee; a
// thread of three or more → 422 MASKED_CALL_NO_CALLEE until STORE-4b's organisation-contact rule exists); both must hold an active role in
// this tenant (403 MASKED_CALL_NOT_MEMBER); `user_blocks` is consulted in BOTH directions (403 MASKED_CALL_BLOCKED). Only then is the
// provider asked to bridge. The record and the audit row (`masked_call.initiated`) carry the conversation and user ids — never a phone
// number. The idempotency key is hashed with the conversation (the STORE-3a shape: varchar(120) safe, one key per thread).
import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { InfraError } from '../../../shared/errors/app-error';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MASKING_PROVIDER, MaskingProvider } from '../gateway/masking-provider.port';
import { MaskedCall } from '../domain/masked-call.entity';
import { DomainEvent, ContextType } from '../domain/messaging.events';
import { MaskedCallRepository } from '../repositories/masked-call.repository';
import { ConversationRepository } from '../repositories/conversation.repository';
import { resolveCallee, viewerOf } from '../domain/conversation-roles';
import { buyerMaskedCall } from '../domain/organisation-thread';
import { encodeKeyset } from '../../../shared/pagination/us-keyset';
import { MaskedCallRefusedError } from '../domain/messaging.errors';
import { InitiateMaskedCallDto } from '../dto/initiate-masked-call.dto';
import { MessagingActor } from './conversation.service';

/** A call whose callee the SERVER already resolved (a module-internal caller — dairy's BMC operator call resolves the custody holder from its
 *  own verdict). NEVER built from a request body: the HTTP route goes through `initiateForConversation`. */
export interface ServerResolvedCall { calleeUserId: string; contextType?: ContextType | string | null; contextId?: string | null }

@Injectable()
export class MaskedCallService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(MASKING_PROVIDER) private readonly provider: MaskingProvider,
    private readonly repo: MaskedCallRepository,
    // HOTFIX-6: appended (optional) so the dairy spec's manual construction keeps its six arguments; Nest always injects both.
    @Optional() private readonly conversations?: ConversationRepository,
    @Optional() @Inject(AUDIT_WRITER) private readonly audit?: AuditWriter,
  ) {}

  /** B1: whom this call may ring — resolved from the conversation, refused by name otherwise. Read-only; one transaction, no network. */
  async resolve(tenantId: string, actor: MessagingActor, conversationId: string): Promise<{ calleeUserId: string; contextType: ContextType | null; contextId: string | null }> {
    const convos = this.conversations;
    if (!convos) throw new InfraError('MASKED_CALL_UNAVAILABLE', 'Could not place the call right now', { reason: 'no_conversation_reader' });
    return this.uow.run(tenantId, async (tx) => {
      const convo = await convos.getForUpdate(tx, tenantId, conversationId);
      if (!convo) throw new MaskedCallRefusedError('MASKED_CALL_NOT_PARTICIPANT');   // an unknown thread answers as a foreign one
      const r = resolveCallee(await convos.participantIds(tenantId, conversationId, tx), actor.userId);
      if (!r.ok) throw new MaskedCallRefusedError(r.refusal);
      const members = await convos.tenantMemberIds(tx, tenantId, [actor.userId, r.calleeUserId]);
      if (!members.has(actor.userId) || !members.has(r.calleeUserId)) throw new MaskedCallRefusedError('MASKED_CALL_NOT_MEMBER');
      if (await convos.blockedEitherWay(tx, actor.userId, r.calleeUserId)) throw new MaskedCallRefusedError('MASKED_CALL_BLOCKED');
      const p = convo.toProps();
      return { calleeUserId: r.calleeUserId, contextType: p.contextType, contextId: p.contextId };
    }, { userId: actor.userId });
  }

  /** THE HTTP ROUTE (B1): a call from a conversation the caller is in, to its one other party — every refusal BEFORE the provider is asked.
   *  The key is hashed with the conversation (varchar(120) safe; one key per thread). */
  async initiateForConversation(tenantId: string, actor: MessagingActor, idemKey: string, dto: InitiateMaskedCallDto, ip: string | null = null) {
    const scoped = createHash('sha256').update(`${dto.conversationId}:${idemKey}`).digest('base64url');
    return this.idem.remember(scoped, actor.userId, 'comm.maskedcall.initiate', () =>
      timed(this.metrics, 'comm.maskedcall.initiate', { tenant: tenantId }, async () => {
        const target = await this.resolve(tenantId, actor, dto.conversationId);
        const call = await this.bridgeAndRecord(tenantId, actor, target, (tx, id) => this.audit
          // the trail: who, which conversation, which call — never a phone number (the provider owns the directory)
          ? this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'masked_call.initiated', entityType: 'masked_call', entityId: id,
            newValue: { conversationId: dto.conversationId, calleeUserId: target.calleeUserId, contextType: target.contextType, contextId: target.contextId }, ip })
          : Promise.resolve());
        // HOTFIX-6 · B2: the answer names no other person — the caller's call id, the conversation and its context only
        return { id: call.id, conversationId: dto.conversationId, contextType: target.contextType, contextId: target.contextId };
      }));
  }

  /** A SERVER-RESOLVED call (module-internal callers only — see ServerResolvedCall). Unchanged contract for dairy's BMC operator call
   *  (TENANT-6d-5), which audits the act itself. */
  async initiate(tenantId: string, actor: MessagingActor, idemKey: string, target: ServerResolvedCall) {
    return this.idem.remember(idemKey, actor.userId, 'comm.maskedcall.initiate', () =>
      timed(this.metrics, 'comm.maskedcall.initiate', { tenant: tenantId }, () =>
        this.bridgeAndRecord(tenantId, actor, { calleeUserId: target.calleeUserId, contextType: (target.contextType ?? null) as ContextType | null, contextId: target.contextId ?? null })));
  }

  private async bridgeAndRecord(tenantId: string, actor: MessagingActor, target: { calleeUserId: string; contextType: ContextType | null; contextId: string | null },
    alsoInTx?: (tx: TxContext, id: string) => Promise<void>) {
    const id = uuidv7();
    const bridged = await this.provider.bridge({ idempotencyKey: id, tenantId, callerUserId: actor.userId, calleeUserId: target.calleeUserId, contextType: target.contextType, contextId: target.contextId });
    if (!bridged.ok || !bridged.providerCallRef) { this.metrics.inc('comm.maskedcall.failed', { reason: bridged.failureReason ?? 'unknown' }); throw new InfraError('MASKED_CALL_UNAVAILABLE', 'Could not place the call right now', { reason: bridged.failureReason }); }
    return this.uow.run(tenantId, async (tx) => {
      const call = MaskedCall.initiate({ id, tenantId, callerUserId: actor.userId, calleeUserId: target.calleeUserId, contextType: target.contextType, contextId: target.contextId, providerCallRef: bridged.providerCallRef! });
      await this.repo.insert(tx, call);
      await this.flush(tx, tenantId, id, call.pullEvents());
      if (alsoInTx) await alsoInTx(tx, id);
      return call.toJSON();
    }, { userId: actor.userId });
  }

  /** Provider call-status webhook → set duration (idempotent). null tenant ⇒ relay-wide lookup by ref. */
  async applyCallStatus(tenantId: string | null, providerCallRef: string, durationSecs: number, recordingMediaId: string | null): Promise<boolean> {
    return this.uow.run(tenantId ?? '', async (tx) => {
      const call = await this.repo.getByProviderRef(tx, providerCallRef);
      if (!call) return false;
      call.complete(durationSecs, recordingMediaId);
      await this.repo.update(tx, call);
      await this.flush(tx, call.toProps().tenantId, call.id, call.pullEvents());
      return true;
    });
  }

  /** The caller's own call log. PC-56 STORE-4b · D3 (survey: the leak HOTFIX-6 left): a caller with no organisation role here (a buyer) reads
   *  `{ id, contextType, contextId, direction, durationSecs, createdAt }` — never `callerUserId` / `calleeUserId`; staff (an organisation role,
   *  read from the database, or a moderator) keep the row. No conversation reader (a module-internal construction) → the buyer's shape
   *  (fail closed). The cursor is µs (B4). */
  async list(tenantId: string, actor: MessagingActor, q: { cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.repo.listForUser(tenantId, actor.userId, q);
    const last = rows[rows.length - 1]?.toProps();
    const nextCursor = rows.length === q.limit && last?.createdAtUs ? encodeKeyset(last.createdAtUs, last.id) : null;
    const isOrgMember = this.conversations ? (await this.conversations.orgMemberIds(tenantId, [actor.userId])).has(actor.userId) : false;
    const staff = viewerOf({ isModerator: actor.isModerator, isOrgMember }) === 'staff';
    const items = rows.map((c) => (staff ? c.toJSON() : buyerMaskedCall(c.toJSON() as Parameters<typeof buyerMaskedCall>[0], actor.userId)));
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string | null, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'masked_call', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
