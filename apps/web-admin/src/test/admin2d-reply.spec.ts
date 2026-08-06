// apps/web-admin/src/test/admin2d-reply.spec.ts · PC-56 ADMIN-2d, console side.
//
// The console's job in this wave is to never overstate a delivery. So the tests that matter are about the DEFAULT CASE:
// what an unrecognised status renders as, what the count means, and which rows are called stuck.
import {
  REPLY_STATUSES, REPLY_LANGUAGES, MIN_BODY, MAX_BODY,
  reachedTheFarmer, stuckRows, deliveredCount, stateClass, stateKey, buildReply,
  type ReplyRow,
} from '../features/support/reply';

const row = (over: Partial<ReplyRow> = {}): ReplyRow =>
  ({ id: 'r1', status: 'queued', queuedAt: '2026-08-06T09:00:00.000Z', ...over });
const bag = (o: Record<string, string>) => (n: string) => o[n] ?? '';

describe('the vocabulary', () => {
  it('mirrors 0101 and contains no word for an unprovable send', () => {
    expect([...REPLY_STATUSES]).toEqual(['queued', 'delivered', 'refused', 'failed']);
    expect(REPLY_STATUSES as readonly string[]).not.toContain('sent');
  });

  it('offers only the languages the platform has templates for', () => {
    // composing in a language with no template would frame non-English words in an English template
    expect([...REPLY_LANGUAGES]).toEqual(['en', 'hi', 'gu']);
  });
});

describe('an unrecognised status is NEVER treated as a success', () => {
  it('reachedTheFarmer is true for delivered and nothing else', () => {
    expect(reachedTheFarmer('delivered')).toBe(true);
    for (const s of ['queued', 'refused', 'failed', 'sent', 'partially_delivered', '']) {
      expect(reachedTheFarmer(s)).toBe(false);
    }
  });

  it('stateClass styles an unknown status as a PROBLEM, not as ok', () => {
    // the next value this enum gains must not arrive on screen in green
    expect(stateClass('delivered')).toBe('kv-status--ok');
    expect(stateClass('queued')).toBe('kv-status--warn');
    expect(stateClass('refused')).toBe('kv-status--danger');
    expect(stateClass('failed')).toBe('kv-status--danger');
    expect(stateClass('sent')).toBe('kv-status--danger');
    expect(stateClass('')).toBe('kv-status--danger');
  });

  it('stateKey falls back to a NON-success wording', () => {
    expect(stateKey('delivered')).toBe('delivered');
    expect(stateKey('queued')).toBe('queued');
    // 'failed' renders as "NOT sent" — the safe reading for something this build does not understand
    expect(stateKey('teleported')).toBe('failed');
  });
});

describe('counting and triage', () => {
  it('counts what the farmer RECEIVED, not what was written', () => {
    const rows = [row({ status: 'delivered' }), row({ id: 'r2' }), row({ id: 'r3', status: 'delivered' }),
      row({ id: 'r4', status: 'failed' })];
    expect(rows).toHaveLength(4);
    expect(deliveredCount(rows)).toBe(2);
  });

  it('calls a row stuck only when it will not arrive without a human', () => {
    // a queued row is WAITING. Including it would fire this warning every minute until nobody read it.
    const rows = [row(), row({ id: 'r2', status: 'delivered' }),
      row({ id: 'r3', status: 'refused', detail: 'no requester' }),
      row({ id: 'r4', status: 'failed', detail: 'render error' })];
    expect(stuckRows(rows).map((r) => r.id)).toEqual(['r3', 'r4']);
  });

  it('reports an empty ticket honestly', () => {
    expect(deliveredCount([])).toBe(0);
    expect(stuckRows([])).toEqual([]);
  });
});

describe('buildReply', () => {
  it('accepts a real answer, trimmed and otherwise untouched', () => {
    const body = '  Your refund of ₹4,200 reached your bank on 4 August — reference RZP-8812.  ';
    const r = buildReply(bag({ body, languageCode: 'HI' }));
    expect(r).toEqual({ ok: true, value: { body: body.trim(), languageCode: 'hi' } });
    // no normalising: the operator's words are not the console's prose
    if (r.ok) expect(r.value.body).toContain('₹4,200');
  });

  it('refuses a reply too short to be an answer', () => {
    expect(buildReply(bag({ body: 'noted', languageCode: 'hi' }))).toEqual({ ok: false, error: 'body' });
    expect(buildReply(bag({ body: '   ', languageCode: 'hi' }))).toEqual({ ok: false, error: 'body' });
    expect(buildReply(bag({ body: 'a'.repeat(MIN_BODY), languageCode: 'hi' })).ok).toBe(true);
    expect(buildReply(bag({ body: 'a'.repeat(MAX_BODY + 1), languageCode: 'hi' }))).toEqual({ ok: false, error: 'bodyLong' });
  });

  it('REQUIRES a language and defaults to none', () => {
    // the farmer being able to read this is the operator's call, not a guess
    expect(buildReply(bag({ body: 'x'.repeat(30) }))).toEqual({ ok: false, error: 'language' });
    expect(buildReply(bag({ body: 'x'.repeat(30), languageCode: 'ta' }))).toEqual({ ok: false, error: 'language' });
  });
});
