// modules/communication/__tests__/store4b-organisation-thread.spec.ts · PC-56 STORE-4b · B1 — the pure half of "messages to the organisation,
// never to a person": who answers (order.manage members, oldest first, capped, never the caller); whose context it is; who may use the generic
// open; the monotonic lock (the rule and the entity); the hidden rule for a reported message; a buyer's call log; the report's own rules on the
// entity; and the service guards with fakes (the generic open, the organisation open's 404 / 422, the µs cursor). The live proof is
// src/__tests__/store4b-messages.integration.spec.ts.
import {
  respondersOf, RESPONDER_CAP, contextOwnerRule, canUseGenericOpen, lockLift, lockWins, hideFlagged, buyerMaskedCall, LISTING_THREAD_STATUSES, ORG_CONTEXT_TYPES,
} from '../domain/organisation-thread';
import { Conversation } from '../domain/conversation.entity';
import { Message } from '../domain/message.entity';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import {
  ConversationLockHeldError, MessageReportOwnError, MessagingForbiddenError, ConversationParticipantNotMemberError, ConversationContextNotFoundError,
  ConversationNoResponderError, ConversationLockedError, MessageReportReasonUnknownError,
} from '../domain/messaging.errors';
import { decodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { OpenOrganisationConversationSchema } from '../dto/open-organisation-conversation.dto';
import { FlagMessageSchema } from '../dto/flag-message.dto';
import { QueryConversationsSchema } from '../dto/query-conversation.dto';

describe('STORE-4b · respondersOf — the organisation\'s side', () => {
  it('oldest membership first, one entry per person (their oldest), never the caller, capped', () => {
    const m = [
      { userId: 'c', grantedAt: '2026-03-01T00:00:00Z' }, { userId: 'a', grantedAt: '2026-01-01T00:00:00Z' },
      { userId: 'b', grantedAt: '2026-02-01T00:00:00Z' }, { userId: 'c', grantedAt: '2025-12-01T00:00:00Z' }, { userId: 'me', grantedAt: '2020-01-01T00:00:00Z' },
    ];
    expect(respondersOf(m, 50, 'me')).toEqual(['c', 'a', 'b']);
    expect(respondersOf(m, 2, 'me')).toEqual(['c', 'a']);
    expect(respondersOf([], 50)).toEqual([]);
    expect(RESPONDER_CAP).toBe(50);
  });
  it('ties break by id; 60 members → 50', () => {
    const same = new Date('2026-01-01T00:00:00Z');
    expect(respondersOf([{ userId: 'z', grantedAt: same }, { userId: 'y', grantedAt: same }])).toEqual(['y', 'z']);
    expect(respondersOf(Array.from({ length: 60 }, (_, i) => ({ userId: `u${String(i).padStart(2, '0')}`, grantedAt: same })))).toHaveLength(50);
  });
});

describe('STORE-4b · whose context, who may open what', () => {
  it('an order belongs to its buyer only; a live listing to anyone; nothing → not theirs', () => {
    expect(contextOwnerRule('order', { exists: true, buyerUserId: 'b1' }, 'b1')).toBe(true);
    expect(contextOwnerRule('order', { exists: true, buyerUserId: 'b1' }, 'b2')).toBe(false);
    expect(contextOwnerRule('order', { exists: false }, 'b1')).toBe(false);
    expect(contextOwnerRule('listing', { exists: true }, 'anyone')).toBe(true);
    expect(contextOwnerRule('listing', { exists: false }, 'anyone')).toBe(false);
    expect(ORG_CONTEXT_TYPES).toEqual(['order', 'listing']);
    expect(LISTING_THREAD_STATUSES).toEqual(['published', 'reserved_auction', 'sold_out']);
  });
  it('the generic open is staff-only', () => {
    expect(canUseGenericOpen('staff')).toBe(true);
    expect(canUseGenericOpen('buyer')).toBe(false);
  });
  it('the DTOs: strict, the two context types, a uuid; a reason identifier; scope is a strict enum', () => {
    expect(OpenOrganisationConversationSchema.safeParse({ contextType: 'order', contextId: '0216a000-0000-7000-8000-000000000001' }).success).toBe(true);
    expect(OpenOrganisationConversationSchema.safeParse({ contextType: 'direct', contextId: '0216a000-0000-7000-8000-000000000001' }).success).toBe(false);
    expect(OpenOrganisationConversationSchema.safeParse({ contextType: 'order', contextId: '0216a000-0000-7000-8000-000000000001', participantUserIds: [] }).success).toBe(false);
    expect(FlagMessageSchema.safeParse({ reason: 'spam' }).success).toBe(true);
    expect(FlagMessageSchema.safeParse({ reason: 'Spam!' }).success).toBe(false);
    expect(FlagMessageSchema.safeParse({}).success).toBe(false);
    expect(QueryConversationsSchema.safeParse({ scope: 'organisation' }).success).toBe(true);
    expect(QueryConversationsSchema.safeParse({ scope: 'maybe' }).success).toBe(false);
  });
});

describe('STORE-4b · the monotonic lock (D2c)', () => {
  it('lockLift: the owner lifts only an owner lock; a moderator lifts any; an open thread has nothing to lift', () => {
    expect(lockLift('owner', 'owner')).toEqual({ ok: true });
    expect(lockLift('moderator', 'owner')).toEqual({ ok: false, refusal: 'CONVERSATION_LOCK_HELD' });
    expect(lockLift('dispute', 'owner')).toEqual({ ok: false, refusal: 'CONVERSATION_LOCK_HELD' });
    for (const k of ['owner', 'moderator', 'dispute'] as const) expect(lockLift(k, 'moderator')).toEqual({ ok: true });
    expect(lockLift(null, 'owner')).toEqual({ ok: true });
  });
  it('lockWins: owner < moderator < dispute; never weaker', () => {
    expect(lockWins(null, 'owner')).toBe(true);
    expect(lockWins('owner', 'dispute')).toBe(true);
    expect(lockWins('moderator', 'dispute')).toBe(true);
    expect(lockWins('dispute', 'owner')).toBe(false);
    expect(lockWins('dispute', 'dispute')).toBe(false);
  });
  it('the entity: a dispute lock refuses the owner by name; a moderator lifts it; the kind travels in the event', () => {
    const c = Conversation.open({ id: 'c1', tenantId: 't1', contextType: 'order', contextId: 'o1' }); c.pullEvents();
    expect(c.lock('dispute')).toBe(true);
    expect(c.pullEvents()[0].payload).toMatchObject({ locked: true, lockKind: 'dispute' });
    expect(() => c.unlock('owner')).toThrow(ConversationLockHeldError);
    expect(c.isLocked).toBe(true);
    expect(c.lock('owner')).toBe(false);                      // weaker: no-op, no event
    expect(c.pullEvents()).toHaveLength(0);
    expect(c.unlock('moderator')).toBe(true);
    expect(c.pullEvents()[0].payload).toMatchObject({ locked: false, lockKind: 'dispute', liftedBy: 'moderator' });
    expect([c.isLocked, c.lockKind]).toEqual([false, null]);
  });
  it('a pre-0216 locked row with no kind reads as `owner` (the backfill rule)', () => {
    const c = Conversation.rehydrate({ id: 'c1', tenantId: 't1', contextType: 'order', contextId: 'o1', isLocked: true });
    expect(c.lockKind).toBe('owner');
    expect(c.unlock('owner')).toBe(true);
  });
});

describe('STORE-4b · a reported message (D2a/b)', () => {
  const base = { id: 'm1', conversationId: 'c1', body: 'pay me outside', voiceMediaId: 'v1', attachmentMediaId: 'a1', isFlagged: true, flagReason: 'fraud', flaggedBy: 'reporter-1', flaggedAt: new Date() };
  it('hidden for every non-moderator: no body, no media, no reason, no reporter', () => {
    const h = hideFlagged(base, false);
    expect(h).toMatchObject({ body: null, voiceMediaId: null, attachmentMediaId: null, hidden: true });
    expect(h).not.toHaveProperty('flagReason'); expect(h).not.toHaveProperty('flaggedBy');
    expect(JSON.stringify(h)).not.toMatch(/reporter-1|pay me outside/);
  });
  it('a moderator keeps the body, the reason and the reporter', () => {
    expect(hideFlagged(base, true)).toMatchObject({ body: 'pay me outside', hidden: false, flagReason: 'fraud', flaggedBy: 'reporter-1' });
  });
  it('an unreported message keeps its body and carries no report field', () => {
    const h = hideFlagged({ ...base, isFlagged: false, flagReason: null, flaggedBy: null }, false);
    expect(h).toMatchObject({ body: 'pay me outside', hidden: false });
    expect(h).not.toHaveProperty('flaggedBy');
  });
  it('the entity: never your own; the first report stands (no second event); the event carries the code only', () => {
    const m = Message.post({ id: 'm1', conversationId: 'c1', tenantId: 't1', senderUserId: 'seller', body: 'x', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false }); m.pullEvents();
    expect(() => m.flag({ by: 'seller', reasonId: 'r', reasonCode: 'spam' })).toThrow(MessageReportOwnError);
    expect(m.flag({ by: 'buyer', reasonId: 'r', reasonCode: 'spam' })).toBe(true);
    const e = m.pullEvents(); expect(e).toHaveLength(1);
    expect(e[0].payload).toEqual({ messageId: 'm1', conversationId: 'c1', reason: 'spam' });
    expect(m.flag({ by: 'other', reasonId: 'r2', reasonCode: 'fraud' })).toBe(false);
    expect(m.toProps().flaggedBy).toBe('buyer');
  });
});

describe('STORE-4b · a buyer\'s call log names no person (D3)', () => {
  it('direction instead of the two user ids', () => {
    const row = { id: 'k1', callerUserId: 'buyer', calleeUserId: 'farmer', contextType: 'order', contextId: 'o1', durationSecs: 30, createdAt: '2026-10-17T00:00:00Z' };
    expect(buyerMaskedCall(row, 'buyer')).toEqual({ id: 'k1', contextType: 'order', contextId: 'o1', direction: 'outgoing', durationSecs: 30, createdAt: '2026-10-17T00:00:00Z' });
    expect(buyerMaskedCall(row, 'farmer').direction).toBe('incoming');
    expect(JSON.stringify(buyerMaskedCall(row, 'buyer'))).not.toMatch(/farmer"|callerUserId|calleeUserId/);
  });
});

// ── the service guards, with fakes ───────────────────────────────────────────────────────────────────────────────────────────────────
function convoHarness(o: { orgMember?: boolean; members?: string[]; order?: { exists: boolean; buyerUserId: string | null }; managers?: { userId: string; grantedAt: string }[] } = {}) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const audit = { write: jest.fn() };
  const repo: any = {
    orgMemberIds: jest.fn(async (_t: string, ids: string[]) => new Set(o.orgMember ? ids : [])),
    tenantMemberIds: jest.fn(async () => new Set(o.members ?? [])),
    findByContext: jest.fn(async () => null), findByContextForActor: jest.fn(async () => null), isParticipant: jest.fn(async () => true),
    insert: jest.fn(), addParticipants: jest.fn(),
    orderBuyerOf: jest.fn(async () => o.order ?? { exists: false, buyerUserId: null }), listingLive: jest.fn(async () => true),
    orderManagersOf: jest.fn(async () => o.managers ?? []),
    getForParticipant: jest.fn(async () => Conversation.rehydrate({ id: 'c-new', tenantId: 't1', contextType: 'order', contextId: 'o1', isLocked: false })),
    summaryForParticipant: jest.fn(async () => null),
  };
  const svc = new ConversationService(uow as any, outbox as any, idem as any, metrics as any, repo, audit as any);
  return { svc, repo, audit };
}
const buyer = { userId: 'b1', isModerator: false };

describe('STORE-4b · ConversationService guards', () => {
  it('the generic open: a buyer → 403 MESSAGING_FORBIDDEN; staff naming a non-member → 422 CONVERSATION_PARTICIPANT_NOT_MEMBER', async () => {
    await expect(convoHarness().svc.openGeneric('t1', buyer, 'k', { contextType: 'direct', participantUserIds: ['f1'] } as any)).rejects.toBeInstanceOf(MessagingForbiddenError);
    await expect(convoHarness({ orgMember: true, members: ['f1'] }).svc.openGeneric('t1', { userId: 's1', isModerator: false }, 'k', { contextType: 'direct', participantUserIds: ['f1', 'x9'] } as any))
      .rejects.toBeInstanceOf(ConversationParticipantNotMemberError);
  });
  it('the organisation open: another buyer\'s order → 404 CONVERSATION_CONTEXT_NOT_FOUND; nobody with order.manage → 422 CONVERSATION_NO_RESPONDER', async () => {
    await expect(convoHarness({ order: { exists: true, buyerUserId: 'b2' } }).svc.openWithOrganisation('t1', buyer, 'k', { contextType: 'order', contextId: 'o1' }))
      .rejects.toBeInstanceOf(ConversationContextNotFoundError);
    await expect(convoHarness({ order: { exists: true, buyerUserId: 'b1' }, managers: [{ userId: 'b1', grantedAt: '2026-01-01T00:00:00Z' }] }).svc.openWithOrganisation('t1', buyer, 'k', { contextType: 'order', contextId: 'o1' }))
      .rejects.toBeInstanceOf(ConversationNoResponderError);
  });
  it('the organisation open: participants = the caller (owner) + the managers (members); audited with a count, never a name', async () => {
    const h = convoHarness({ order: { exists: true, buyerUserId: 'b1' }, managers: [{ userId: 'f2', grantedAt: '2026-02-01T00:00:00Z' }, { userId: 'f1', grantedAt: '2026-01-01T00:00:00Z' }] });
    await h.svc.openWithOrganisation('t1', buyer, 'k', { contextType: 'order', contextId: 'o1' }, '10.0.0.1');
    expect(h.repo.addParticipants.mock.calls[0][2]).toEqual([{ userId: 'b1', role: 'owner' }, { userId: 'f1', role: 'member' }, { userId: 'f2', role: 'member' }]);
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({ action: 'conversation.opened_with_organisation', newValue: { contextType: 'order', contextId: 'o1', responders: 2 }, ip: '10.0.0.1' });
  });
});

describe('STORE-4b · MessageService: the report and the lock kind', () => {
  function h(o: { reasonId?: string | null; sender?: string; locked?: 'owner' | 'dispute' } = {}) {
    const tx = { query: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const msg = Message.rehydrate({ id: 'm1', conversationId: 'c1', tenantId: 't1', senderUserId: o.sender ?? 'f1', body: 'b', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false, createdAtUs: '2026-10-17T00:00:00.123456Z' });
    const messages = { getForUpdate: jest.fn(async () => msg), update: jest.fn(), reportReasonId: jest.fn(async () => (o.reasonId === undefined ? 'lv1' : o.reasonId)), insert: jest.fn() };
    const convo = Conversation.rehydrate({ id: 'c1', tenantId: 't1', contextType: 'order', contextId: 'o1', isLocked: !!o.locked, lockKind: o.locked ?? null });
    const conversations = { isParticipant: jest.fn(async () => true), orgMemberIds: jest.fn(async () => new Set<string>(['f1'])), getForUpdate: jest.fn(async () => convo) };
    const svc = new MessageService(uow as any, { write: jest.fn() } as any, { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) } as any,
      { inc: jest.fn(), observe: jest.fn() } as any, messages as any, conversations as any, { write: jest.fn() } as any);
    return { svc, messages };
  }
  it('an unknown reason → 422 by name; your own → 422; a report answers the reporter HIDDEN', async () => {
    await expect(h({ reasonId: null }).svc.flag('t1', buyer, 'm1', 'k', { reason: 'nope' })).rejects.toBeInstanceOf(MessageReportReasonUnknownError);
    await expect(h({ sender: 'b1' }).svc.flag('t1', buyer, 'm1', 'k', { reason: 'spam' })).rejects.toBeInstanceOf(MessageReportOwnError);
    const x = h(); const out = await x.svc.flag('t1', buyer, 'm1', 'k', { reason: 'spam' });
    expect(out).toMatchObject({ body: null, hidden: true, from: 'organisation' });
    expect(out).not.toHaveProperty('flaggedBy');
    expect(x.messages.update).toHaveBeenCalledTimes(1);
  });
  it('post to a locked thread → CONVERSATION_LOCKED with the kind in the details', async () => {
    const err = await h({ locked: 'dispute' }).svc.post('t1', buyer, 'c1', 'k', { body: 'x' } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConversationLockedError);
    expect(err.details).toMatchObject({ lockKind: 'dispute' });
  });
});

describe('STORE-4b · B4 the µs cursor', () => {
  it('a pre-4b millisecond cursor is page one; a µs cursor round-trips', () => {
    const ms = Buffer.from(`2026-10-17T00:00:00.123Z|0216a000-0000-7000-8000-000000000001`).toString('base64');
    expect(decodeKeyset(ms, UUID_RE)).toBeUndefined();
    const us = Buffer.from(`2026-10-17T00:00:00.123456Z|0216a000-0000-7000-8000-000000000001`).toString('base64url');
    expect(decodeKeyset(us, UUID_RE)).toEqual({ ts: '2026-10-17T00:00:00.123456Z', id: '0216a000-0000-7000-8000-000000000001' });
  });
});
