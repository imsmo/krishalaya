// apps/web-storefront/src/test/store4b-messages.spec.ts · PC-56 STORE-4b · C6 — the pure half of the messages list, the thread and the report chain:
// the preview (hidden · yours · theirs · labels · none), the context chip, the lock key by kind, the context link, `from` keys, the body view, who
// may be reported, the failure maps (open · send · report), the query readers (an unknown status / code / key is dropped), the entry rule, the
// refusal registry (exhaustive, unique, every key in every catalogue, every surface printed) and the i18n parity (1,930 keys ×3).
import { contextChip, lockKey, messagesHref, OPEN_KEY_RE, openFailureOf, previewOf, readMessagesQuery, showsMessageOrg } from '../features/store4b/messages';
import {
  bodyView, canReport, contextLink, readReportQuery, readThreadQuery, REPORT_KEY_RE, reportFailureOf, reportHref, SEND_KEY_RE, sendFailureOf, threadHref, VOICE_PLAYBACK, whoKey,
} from '../features/store4b/thread';
import { STORE4B_REFUSALS, STORE4B_DELTAS, STORE4B_CHAIN_PAGES, store4bRefusalKeys } from '../features/store4b/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const base = { lastMessageAt: null, lastMessageBody: null, lastMessageHasVoice: false, lastMessageHasAttachment: false, lastMessageFromYou: false, lastMessageHidden: false };

describe('STORE-4b · the list\'s rules', () => {
  it('the preview: a reported message is HIDDEN (even if a body were served); yours carries fromYou; labels; none', () => {
    expect(previewOf({ ...base, lastMessageHidden: true, lastMessageBody: 'leaked?' })).toEqual({ kind: 'hidden' });
    expect(previewOf({ ...base, lastMessageBody: 'Gate 2', lastMessageFromYou: true })).toEqual({ kind: 'text', text: 'Gate 2', fromYou: true });
    expect(previewOf({ ...base, lastMessageBody: 'Ready' })).toEqual({ kind: 'text', text: 'Ready', fromYou: false });
    expect(previewOf({ ...base, lastMessageHasVoice: true })).toEqual({ kind: 'voice', fromYou: false });
    expect(previewOf({ ...base, lastMessageHasAttachment: true, lastMessageFromYou: true })).toEqual({ kind: 'attachment', fromYou: true });
    expect(previewOf(base)).toEqual({ kind: 'none' });
    expect((previewOf({ ...base, lastMessageBody: 'x'.repeat(300) }) as { text: string }).text.length).toBe(140);
  });
  it('the chip: the order number / the listing title from the API\'s label; anything else by its kind', () => {
    expect(contextChip({ contextType: 'order', contextLabel: 'KV2026-1' })).toEqual({ kind: 'order', label: 'KV2026-1' });
    expect(contextChip({ contextType: 'listing', contextLabel: 'Groundnut' })).toEqual({ kind: 'listing', label: 'Groundnut' });
    expect(contextChip({ contextType: 'order', contextLabel: null })).toEqual({ kind: 'other', type: 'order' });
  });
  it('the lock key by kind; an unknown kind reads as the plain lock', () => {
    expect([lockKey('owner'), lockKey('moderator'), lockKey('dispute'), lockKey('weird'), lockKey(null)])
      .toEqual(['store4b.lock.owner', 'store4b.lock.moderator', 'store4b.lock.dispute', 'messages.locked', 'messages.locked']);
  });
  it('the list query: a bounded cursor; an entry failure only by a known code', () => {
    expect(readMessagesQuery({ cursor: 'abc_-=' })).toEqual({ cursor: 'abc_-=', openFailure: null });
    expect(readMessagesQuery({ cursor: '<script>' }).cursor).toBeUndefined();
    expect(readMessagesQuery({ failure: 'open', code: 'no_responder' }).openFailure).toBe('no_responder');
    expect(readMessagesQuery({ failure: 'open', code: 'drop' }).openFailure).toBeNull();
    expect(messagesHref('anand-fpo', { failure: 'open', code: 'context' })).toBe('/anand-fpo/messages?failure=open&code=context');
  });
  it('the entry point: signed in AND communication ON — never on an unreadable flag set', () => {
    expect(showsMessageOrg(true, { communication: true })).toBe(true);
    expect(showsMessageOrg(false, { communication: true })).toBe(false);
    expect(showsMessageOrg(true, { communication: false })).toBe(false);
    expect(showsMessageOrg(true, null)).toBe(false);
    expect(OPEN_KEY_RE.test('openorg:0216aaaa-0000-4000-8000-000000000001')).toBe(true);
    expect(OPEN_KEY_RE.test('openorg:x')).toBe(false);
  });
  it('the open\'s failures by name', () => {
    expect(['CONVERSATION_CONTEXT_NOT_FOUND', 'CONVERSATION_NO_RESPONDER', 'MESSAGING_FORBIDDEN', 'NOT_FOUND', 'BOOM'].map((c) => openFailureOf(c)))
      .toEqual(['context', 'no_responder', 'forbidden', 'off', 'server']);
  });
});

describe('STORE-4b · the thread\'s rules', () => {
  it('the context link under THIS store; none without an id or for another context', () => {
    expect(contextLink('anand-fpo', { contextType: 'order', contextId: 'o1' })).toEqual({ kind: 'order', href: '/anand-fpo/orders/o1' });
    expect(contextLink('anand-fpo', { contextType: 'listing', contextId: 'l1' })).toEqual({ kind: 'listing', href: '/anand-fpo/listings/l1' });
    expect(contextLink('anand-fpo', { contextType: 'support_ticket', contextId: 't1' })).toBeNull();
    expect(contextLink('anand-fpo', { contextType: 'order', contextId: null })).toBeNull();
  });
  it('`from` keys; the body view (hidden wins); voice playback is refused', () => {
    expect(['you', 'organisation', 'platform', 'system', undefined].map((f) => whoKey(f as never)))
      .toEqual(['messages.you', 'store4.from.organisation', 'store4.from.platform', 'store4.from.system', 'store4.from.system']);
    expect(bodyView({ hidden: true, isFlagged: true, body: null, voiceMediaId: null, attachmentMediaId: null })).toEqual({ kind: 'hidden' });
    expect(bodyView({ isFlagged: true, body: null, voiceMediaId: null, attachmentMediaId: null })).toEqual({ kind: 'hidden' });
    expect(bodyView({ isFlagged: false, body: 'hi', voiceMediaId: null, attachmentMediaId: null })).toEqual({ kind: 'text', text: 'hi' });
    expect(bodyView({ isFlagged: false, body: null, voiceMediaId: 'v', attachmentMediaId: null })).toEqual({ kind: 'voice' });
    expect(VOICE_PLAYBACK).toBe(false);
  });
  it('who may be reported: another party\'s visible message only', () => {
    expect(canReport({ from: 'organisation', hidden: false, isFlagged: false })).toBe(true);
    expect(canReport({ from: 'you', hidden: false, isFlagged: false })).toBe(false);
    expect(canReport({ from: 'organisation', hidden: true, isFlagged: true })).toBe(false);
  });
  it('send and report failures by name', () => {
    expect(['CONVERSATION_LOCKED', 'CONVERSATION_NOT_FOUND', 'NOT_FOUND', 'MESSAGE_EMPTY', 'X'].map((c) => sendFailureOf(c))).toEqual(['locked', 'not_found', 'off', 'empty', 'server']);
    expect(['MESSAGE_NOT_FOUND', 'MESSAGE_REPORT_OWN', 'MESSAGE_REPORT_REASON_UNKNOWN', 'VALIDATION_FAILED', 'NOT_FOUND', 'X'].map((c) => reportFailureOf(c)))
      .toEqual(['not_found', 'own', 'reason', 'reason', 'off', 'server']);
  });
  it('the query readers drop anything unknown; the keys are re-validated', () => {
    expect(readThreadQuery({ status: 'senderr', code: 'lock_dispute' })).toEqual({ status: 'senderr', code: 'lock_dispute' });
    expect(readThreadQuery({ status: 'senderr', code: 'lock_evil' })).toEqual({ status: 'senderr', code: null });
    expect(readThreadQuery({ status: 'hacked' })).toEqual({ status: null, code: null });
    expect(readReportQuery({ failure: 'own', key: 'report:0216abcd-0000-4000-8000-000000000001', reason: 'spam' }))
      .toEqual({ failure: 'own', key: 'report:0216abcd-0000-4000-8000-000000000001', reason: 'spam' });
    expect(readReportQuery({ failure: 'nope', key: 'send:0216abcd-0000-4000-8000-000000000001', reason: 'Spam!' })).toEqual({ failure: null, key: null, reason: null });
    expect(SEND_KEY_RE.test('send:0216abcd-0000-4000-8000-000000000001')).toBe(true);
    expect(REPORT_KEY_RE.test('report:0216abcd-0000-4000-8000-000000000001')).toBe(true);
    expect(threadHref('anand-fpo', 'c1', { status: 'reported' })).toBe('/anand-fpo/messages/c1?status=reported');
    expect(reportHref('anand-fpo', 'c1', 'm1', { failure: 'own' })).toBe('/anand-fpo/messages/c1/report/m1?failure=own');
  });
});

describe('STORE-4b · the refusal registry', () => {
  it('16 refusals, unique ids and keys, every key in every catalogue, every surface printed', () => {
    expect(STORE4B_REFUSALS.length).toBe(16);
    expect(new Set(STORE4B_REFUSALS.map((r) => r.id)).size).toBe(16);
    expect(new Set(STORE4B_REFUSALS.map((r) => r.key)).size).toBe(16);
    for (const r of STORE4B_REFUSALS) for (const [l, cat] of Object.entries(CATS)) expect([l, r.key, r.key in cat]).toEqual([l, r.key, true]);
    for (const s of ['messages', 'thread', 'report'] as const) expect(store4bRefusalKeys(s).length).toBeGreaterThan(0);
    expect(STORE4B_REFUSALS.map((r) => r.id)).toEqual(expect.arrayContaining(['block', 'translation', 'transcript', 'ai', 'kyc', 'mic', 'waveform', 'read_receipts', 'offline_queue',
      'counts', 'platform_support', 'safety_desk', 'flagged_off', 'unread_badge', 'voice_playback']));
  });
  it('the chain pages are the 8 canon files; the DELTAs are named', () => {
    expect(STORE4B_CHAIN_PAGES.map((p) => p.file)).toEqual(['W297-store-messages.html', 'W298-store-message-thread.html', 'W3109-store-message-mutate-confirm.html',
      'W3110-store-message-mutate-success.html', 'W3111-store-message-mutate-failure.html', 'W3112-store-messages-mutate-confirm.html', 'W3113-store-messages-mutate-success.html',
      'W3114-store-messages-mutate-failure.html']);
    expect(STORE4B_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['messages_route', 'send_no_confirm', 'retry_reload']));
  });
  it('i18n parity: en / hi / gu hold the same keys (1,930 each — 1,863 at 4c + 69 − 2)', () => {
    const k = (c: Record<string, string>) => Object.keys(c).sort();
    expect(k(hi)).toEqual(k(en)); expect(k(gu)).toEqual(k(en));
    // PC-56 HOTFIX-7: + trace.recordedBy / trace.notPublishedTitle / trace.notPublishedBody (×3) → 1,933
    // PC-56 STORE-5a: + 113 store5a.* + store3a.received.confirmCod; − store3a.received.codLine and the seven retired platform-form review.* keys → 2,039
    // PC-56 STORE-5b: + 163 (store5b.* 144, trace.step.* 9, trace.meta.* 8, the self_declared chip ×2) − 5 retired v2 trace.* keys → 2,197
    // PC-56 HOTFIX-8: + 1 (offline.shell.home — the session-free shell's header label) → 2,198
    // PC-56 STORE-6a: + 157 store6.* (the offline page, money never queues, app & install, the chain, reasons, band, update) − offline.hint → 2,354
    expect(Object.keys(en).length).toBe(2354);
  });
});
