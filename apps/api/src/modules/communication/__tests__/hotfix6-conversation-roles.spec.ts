// modules/communication/__tests__/hotfix6-conversation-roles.spec.ts · PC-56 HOTFIX-6 · B1 + B2 — the pure half: who the viewer is, who wrote a
// message as the buyer reads it, the two summary shapes, and whom a masked call may ring. (The live proof is
// src/__tests__/store4-hotfix6-identity-calls.integration.spec.ts.)
import { viewerOf, fromOf, buyerSummary, staffSummary, buyerMessage, staffMessage, resolveCallee, MESSAGE_FROM, RawConversationSummary } from '../domain/conversation-roles';

const ORG = new Set(['farmer-1']);
const RAW: RawConversationSummary = {
  id: 'c1', contextType: 'order', contextId: 'o1', isLocked: false, createdAt: new Date('2026-10-16T05:00:00Z'), isArchived: false, unreadCount: 2,
  lastMessageAt: null, lastMessageBody: 'Ready', lastMessageHasAttachment: false, lastMessageHasVoice: false,
  counterpartyName: 'Ramesh Kumar Patel', counterpartyRole: 'member', counterpartyUserId: 'farmer-1', otherIsOrg: true, orgName: 'Anand FPO', contextLabel: 'KV2026-0A1B2C3D',
};

describe('HOTFIX-6 · viewer and `from`', () => {
  it('staff = a moderator or an organisation role; everyone else reads as the buyer', () => {
    expect(viewerOf({ isModerator: false, isOrgMember: false })).toBe('buyer');
    expect(viewerOf({ isModerator: false, isOrgMember: true })).toBe('staff');
    expect(viewerOf({ isModerator: true, isOrgMember: false })).toBe('staff');
  });
  it('from: null sender → system; the viewer → you; an organisation member → organisation; anyone else → platform', () => {
    expect([fromOf(null, 'b', ORG), fromOf('b', 'b', ORG), fromOf('farmer-1', 'b', ORG), fromOf('x', 'b', ORG)]).toEqual(['system', 'you', 'organisation', 'platform']);
    expect(MESSAGE_FROM).toEqual(['you', 'organisation', 'platform', 'system']);
  });
});

describe('HOTFIX-6 · one read model, two shapes', () => {
  it('the buyer\'s summary: the ORGANISATION\'s name, a party label, the context label — no full_name, no user id', () => {
    const b = buyerSummary(RAW);
    expect(b).toMatchObject({ counterpartyName: 'Anand FPO', counterpartyRole: 'organisation', contextLabel: 'KV2026-0A1B2C3D', unreadCount: 2 });
    expect(b).not.toHaveProperty('counterpartyUserId');
    expect(JSON.stringify(b)).not.toMatch(/Ramesh|farmer-1/);
  });
  it('a counterparty outside the organisation: no name at all, party `platform`; no counterparty: both null', () => {
    expect(buyerSummary({ ...RAW, otherIsOrg: false })).toMatchObject({ counterpartyName: null, counterpartyRole: 'platform' });
    expect(buyerSummary({ ...RAW, counterpartyUserId: null, counterpartyName: null })).toMatchObject({ counterpartyName: null, counterpartyRole: null });
  });
  it('the staff summary keeps the name, the role in the thread and the id (plus the context label)', () => {
    expect(staffSummary(RAW)).toMatchObject({ counterpartyName: 'Ramesh Kumar Patel', counterpartyRole: 'member', counterpartyUserId: 'farmer-1', contextLabel: 'KV2026-0A1B2C3D' });
    expect(staffSummary(RAW)).not.toHaveProperty('orgName');
  });
  it('the buyer\'s message carries `from`, never senderUserId; the staff message keeps the sender id', () => {
    const m = { id: 'm1', conversationId: 'c1', senderUserId: 'farmer-1', body: 'Ready', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false };
    const b = buyerMessage(m, 'buyer-1', ORG);
    expect(b.from).toBe('organisation');
    expect(b).not.toHaveProperty('senderUserId');
    expect(staffMessage(m)).toMatchObject({ senderUserId: 'farmer-1' });
  });
});

describe('HOTFIX-6 · whom a masked call rings (founder D2)', () => {
  it('the ONE other participant; never anyone the client names', () => {
    expect(resolveCallee(['buyer-1', 'farmer-1'], 'buyer-1')).toEqual({ ok: true, calleeUserId: 'farmer-1' });
    expect(resolveCallee(['buyer-1', 'farmer-1', 'buyer-1'], 'buyer-1')).toEqual({ ok: true, calleeUserId: 'farmer-1' });
  });
  it('not a participant → NOT_PARTICIPANT; alone or three or more → NO_CALLEE', () => {
    expect(resolveCallee(['buyer-1', 'farmer-1'], 'stranger')).toEqual({ ok: false, refusal: 'MASKED_CALL_NOT_PARTICIPANT' });
    expect(resolveCallee(['buyer-1'], 'buyer-1')).toEqual({ ok: false, refusal: 'MASKED_CALL_NO_CALLEE' });
    expect(resolveCallee(['buyer-1', 'farmer-1', 'agent-1'], 'buyer-1')).toEqual({ ok: false, refusal: 'MASKED_CALL_NO_CALLEE' });
  });
});
