// modules/communication/__tests__/messaging.service.spec.ts · service unit tests with fakes.
// Pins: post is membership-gated (non-participant ⇒ 404, no IDOR); a LOCKED thread rejects new messages; a
// posted message emits comm.message_posted carrying the OTHER participants as recipientUserIds (the bridge into
// the notification fanout); masked-call initiate degrades to a typed error (no row) when the provider is down.
import { MessageService } from '../services/message.service';
import { MaskedCallService } from '../services/masked-call.service';
import { Conversation } from '../domain/conversation.entity';
import { ConversationNotFoundError, ConversationLockedError } from '../domain/messaging.errors';
import { InfraError } from '../../../shared/errors/app-error';

const convo = (locked = false) => Conversation.rehydrate({ id: 'c1', tenantId: 't1', contextType: 'order', contextId: 'o1', isLocked: locked });

function msgHarness(opts: { convo?: Conversation | null; isParticipant?: boolean; participants?: string[] } = {}) {
  const writes: any[] = [];
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn(async (_tx: any, e: any) => { writes.push(e); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const messages = { insert: jest.fn(), getForUpdate: jest.fn(), update: jest.fn(), listForConversation: jest.fn() };
  const conversations = {
    getForUpdate: jest.fn(async () => (opts.convo === undefined ? convo() : opts.convo)),
    isParticipant: jest.fn(async () => opts.isParticipant ?? true),
    participantIds: jest.fn(async () => opts.participants ?? ['u1', 'u2', 'u3']),
    markRead: jest.fn(),
  };
  const svc = new MessageService(uow as any, outbox as any, idem as any, metrics as any, messages as any, conversations as any);
  return { svc, writes, messages };
}
const actor = { userId: 'u1', isModerator: false };

describe('MessageService.post', () => {
  it('emits comm.message_posted with the OTHER participants as recipientUserIds', async () => {
    const h = msgHarness();
    await h.svc.post('t1', actor, 'c1', 'idem-1', { body: 'hello' } as any);
    expect(h.messages.insert).toHaveBeenCalledTimes(1);
    const posted = h.writes.find((e) => e.eventType === 'comm.message_posted');
    expect(posted).toBeTruthy();
    expect(posted.payload.recipientUserIds.sort()).toEqual(['u2', 'u3']);   // sender u1 excluded
  });
  it('404s a non-participant (no IDOR)', async () => {
    const h = msgHarness({ isParticipant: false });
    await expect(h.svc.post('t1', actor, 'c1', 'idem-2', { body: 'x' } as any)).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
  it('rejects posting to a locked thread', async () => {
    const h = msgHarness({ convo: convo(true) });
    await expect(h.svc.post('t1', actor, 'c1', 'idem-3', { body: 'x' } as any)).rejects.toBeInstanceOf(ConversationLockedError);
  });
});

function callHarness(bridgeOk: boolean) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const provider = { providerCode: 'fake', bridge: jest.fn(async () => (bridgeOk ? { ok: true, providerCallRef: 'ref-1' } : { ok: false, failureReason: 'provider_unavailable' })) };
  const repo = { insert: jest.fn(), getByProviderRef: jest.fn(), update: jest.fn(), getForUpdate: jest.fn(), listForUser: jest.fn() };
  const svc = new MaskedCallService(uow as any, outbox as any, idem as any, metrics as any, provider as any, repo as any);
  return { svc, repo };
}

describe('MaskedCallService.initiate', () => {
  it('records the call (user ids + provider ref only) when the bridge succeeds', async () => {
    const h = callHarness(true);
    const out = await h.svc.initiate('t1', { userId: 'a', isModerator: false }, 'idem-1', { calleeUserId: 'b' } as any);
    expect(h.repo.insert).toHaveBeenCalledTimes(1);
    expect(out.callerUserId).toBe('a'); expect(out.calleeUserId).toBe('b');
    // no phone numbers leaked. PC-56 TEST-1: uuids are blanked first — a v7 id's 12-hex tail is all decimal digits often enough
    // (~3% of runs) that this assertion failed at random on a perfectly clean output.
    expect(JSON.stringify(out).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')).not.toMatch(/\+?\d{10}/);
  });
  it('degrades to a typed error and records NOTHING when the provider is down', async () => {
    const h = callHarness(false);
    await expect(h.svc.initiate('t1', { userId: 'a', isModerator: false }, 'idem-2', { calleeUserId: 'b' } as any)).rejects.toBeInstanceOf(InfraError);
    expect(h.repo.insert).not.toHaveBeenCalled();
  });
});
