// Unit tests for the PURE chat-thread presenters (features/messaging/message-view). No React/native deps (SDK
// type is `import type` → erased). R2-02(a): covers the empty-state/inverted-list gating predicate that fixes the
// founder-reported upside-down "Say hello 👋" (an `inverted` FlatList flips ListEmptyComponent 180° too — the
// robust fix is to never mount the inverted list while there are zero messages, see ChatThreadScreen.tsx).
import { presentMessage, canSend, normalizeBody, dayKey, isDayBoundary, hasMessages, type MessageView } from '../../features/messaging/message-view';
import type { Message } from '@krishalaya/sdk-js';

const msg = (over: Partial<Message>): Message => ({
  id: 'm1', conversationId: 'c1', senderUserId: 'u1', body: 'hi', attachmentMediaId: null, voiceMediaId: null,
  isAiGenerated: false, isFlagged: false, createdAt: '2024-01-01T10:00:00.000Z', ...over,
});

describe('hasMessages (R2-02a: gates the inverted FlatList vs. the upright empty-state)', () => {
  it('false for an empty transcript — screen renders the plain, upright EmptyState instead of the inverted list', () => {
    expect(hasMessages([])).toBe(false);
  });
  it('true once there is at least one message — safe to mount the inverted FlatList', () => {
    const view: MessageView = { id: 'm1', mine: false, kind: 'text', body: 'hi', mediaId: null, flagged: false, createdAt: '2024-01-01T10:00:00.000Z' };
    expect(hasMessages([view])).toBe(true);
  });
});

describe('presentMessage', () => {
  it('classifies text/image/voice/empty by which field is set', () => {
    expect(presentMessage(msg({ body: 'hello' }), 'u1').kind).toBe('text');
    expect(presentMessage(msg({ body: null, attachmentMediaId: 'media1' }), 'u1').kind).toBe('image');
    expect(presentMessage(msg({ body: null, voiceMediaId: 'v1' }), 'u1').kind).toBe('voice');
    expect(presentMessage(msg({ body: null }), 'u1').kind).toBe('empty');
  });
  it('flags "mine" against the viewer id', () => {
    expect(presentMessage(msg({ senderUserId: 'u1' }), 'u1').mine).toBe(true);
    expect(presentMessage(msg({ senderUserId: 'u2' }), 'u1').mine).toBe(false);
  });
});

describe('canSend', () => {
  it('requires non-blank text or an attachment', () => {
    expect(canSend('  ', false)).toBe(false);
    expect(canSend('hi', false)).toBe(true);
    expect(canSend('', true)).toBe(true);
  });
});

describe('normalizeBody', () => {
  it('trims and bounds to 4000 chars', () => {
    expect(normalizeBody('  hi  ')).toBe('hi');
    expect(normalizeBody('x'.repeat(5000)).length).toBe(4000);
  });
});

describe('dayKey / isDayBoundary (day dividers on the inverted, newest-first list)', () => {
  const v = (id: string, iso?: string): MessageView => ({ id, mine: false, kind: 'text', body: 'x', mediaId: null, flagged: false, createdAt: iso });
  it('dayKey handles absent/unparseable dates', () => {
    expect(dayKey(undefined)).toBe('');
    expect(dayKey('not-a-date')).toBe('');
    expect(dayKey('2024-03-05T09:00:00.000Z')).toBe('2024-03-05');
  });
  it('marks the oldest message of each day (last item, or a day change vs. the older neighbour)', () => {
    const views = [
      v('a', '2024-03-05T20:00:00.000Z'), // newest
      v('b', '2024-03-05T09:00:00.000Z'), // same day as c
      v('c', '2024-03-04T18:00:00.000Z'), // oldest — always a boundary
    ];
    expect(isDayBoundary(views, 0)).toBe(false); // a: same day as b below it
    expect(isDayBoundary(views, 1)).toBe(true);  // b: day differs from c below it
    expect(isDayBoundary(views, 2)).toBe(true);  // c: last item overall
  });
  it('out-of-range index is never a boundary', () => {
    expect(isDayBoundary([], 0)).toBe(false);
    expect(isDayBoundary([v('a')], -1)).toBe(false);
  });
});
