// modules/communication/__tests__/messaging-domain.spec.ts · pure-domain invariants (no I/O).
// Pins: a conversation requires a contextId unless 'direct'; lock/unlock are idempotent + emit; a message must
// carry body|voice|attachment; flag is idempotent; a masked call records duration once (second report ignored).
import { Conversation } from '../domain/conversation.entity';
import { Message } from '../domain/message.entity';
import { MaskedCall } from '../domain/masked-call.entity';
import { InvalidConversationError, EmptyMessageError } from '../domain/messaging.errors';

describe('Conversation', () => {
  it('requires a contextId for a context-linked thread; direct needs none', () => {
    expect(() => Conversation.open({ id: 'c1', tenantId: 't1', contextType: 'order', contextId: null })).toThrow(InvalidConversationError);
    expect(Conversation.open({ id: 'c1', tenantId: 't1', contextType: 'direct', contextId: null }).isLocked).toBe(false);
  });
  it('lock/unlock toggles + emits; lock is idempotent', () => {
    const c = Conversation.open({ id: 'c1', tenantId: 't1', contextType: 'order', contextId: 'o1' });
    c.pullEvents();
    // PC-56 STORE-4b · D2c: a lock carries its kind; the opener's own lock is `owner`, which the owner may lift
    c.lock('owner'); expect(c.isLocked).toBe(true);
    const evts = c.pullEvents(); expect(evts).toHaveLength(1);
    c.lock('owner'); expect(c.pullEvents()).toHaveLength(0);   // idempotent — no second event
    c.unlock('owner'); expect(c.isLocked).toBe(false);
  });
});

describe('Message', () => {
  it('rejects an empty message (no body/voice/attachment)', () => {
    expect(() => Message.post({ id: 'm1', conversationId: 'c1', tenantId: 't1', senderUserId: 'u1', body: null, voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false })).toThrow(EmptyMessageError);
  });
  it('accepts a voice-only message and emits MessagePosted', () => {
    const m = Message.post({ id: 'm1', conversationId: 'c1', tenantId: 't1', senderUserId: 'u1', body: null, voiceMediaId: 'v1', attachmentMediaId: null, isAiGenerated: false });
    expect(m.pullEvents().map((e) => e.type)).toContain('comm.message_posted');
  });
  it('flag is idempotent', () => {
    const m = Message.post({ id: 'm1', conversationId: 'c1', tenantId: 't1', senderUserId: 'u1', body: 'hi', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false });
    // PC-56 STORE-4b · D2a: a report has a reporter and a reason; a second report answers the same with no event
    const r = { by: 'u2', reasonId: 'lv-spam', reasonCode: 'spam' };
    m.pullEvents(); m.flag(r); expect(m.isFlagged).toBe(true);
    expect(m.pullEvents()).toHaveLength(1); m.flag({ ...r, by: 'u3' }); expect(m.pullEvents()).toHaveLength(0);
  });
});

describe('MaskedCall', () => {
  it('records duration once; a second completion report is ignored (idempotent)', () => {
    const c = MaskedCall.initiate({ id: 'k1', tenantId: 't1', callerUserId: 'a', calleeUserId: 'b', contextType: 'order', contextId: 'o1', providerCallRef: 'ref-1' });
    c.pullEvents();
    c.complete(42, null); expect(c.toJSON().durationSecs).toBe(42);
    expect(c.pullEvents()).toHaveLength(1);
    c.complete(99, null); expect(c.toJSON().durationSecs).toBe(42);   // unchanged
    expect(c.pullEvents()).toHaveLength(0);
  });
  it('clamps a negative duration to 0', () => {
    const c = MaskedCall.initiate({ id: 'k1', tenantId: 't1', callerUserId: 'a', calleeUserId: 'b', contextType: null, contextId: null, providerCallRef: 'ref-1' });
    c.complete(-5, null); expect(c.toJSON().durationSecs).toBe(0);
  });
});
