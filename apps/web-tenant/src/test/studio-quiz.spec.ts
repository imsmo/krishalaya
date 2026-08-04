import { parseQuizText, buildLive, liveActions } from '../features/studio/quiz';

// The CANONICAL consumer contract (mirrors apps/mobile features/education/learn.ts parseQuiz): every question
// must have string q, ≥2 string options, integer answer within range; hint only when non-empty.
function assertCanonical(value: { questions: Array<{ q: string; options: string[]; answer: number; hint?: string }> }) {
  expect(value.questions.length).toBeGreaterThan(0);
  for (const item of value.questions) {
    expect(typeof item.q).toBe('string');
    expect(Array.isArray(item.options)).toBe(true);
    expect(item.options.length).toBeGreaterThanOrEqual(2);
    expect(item.options.every((o) => typeof o === 'string')).toBe(true);
    expect(Number.isInteger(item.answer)).toBe(true);
    expect(item.answer).toBeGreaterThanOrEqual(0);
    expect(item.answer).toBeLessThan(item.options.length);
    if ('hint' in item) expect((item.hint as string).length).toBeGreaterThan(0);
  }
}

describe('features/studio/quiz (PC-26b)', () => {
  it('parses the author format into the canonical learner shape (round-trip contract)', () => {
    const r = parseQuizText(`Q: How often should drip lines be flushed?
A) Never
*B) Every 2-4 weeks
C) Only when clogged
H: Flushing prevents emitter clogging.

Q: Best time to irrigate in summer?
*A) Early morning
B) Noon`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      assertCanonical(r.value);
      expect(r.value.questions[0].answer).toBe(1);
      expect(r.value.questions[0].hint).toBe('Flushing prevents emitter clogging.');
      expect(r.value.questions[1].answer).toBe(0);
      expect(r.value.questions[1].hint).toBeUndefined();
    }
  });

  it('rejects: empty, missing Q, <2 options, no/duplicate correct mark', () => {
    expect(parseQuizText('   ')).toEqual({ ok: false, error: 'empty' });
    expect(parseQuizText('A) one\n*B) two')).toEqual({ ok: false, error: 'question' });
    expect(parseQuizText('Q: x\n*A) only')).toEqual({ ok: false, error: 'options' });
    expect(parseQuizText('Q: x\nA) one\nB) two')).toEqual({ ok: false, error: 'answer' });
    expect(parseQuizText('Q: x\n*A) one\n*B) two')).toEqual({ ok: false, error: 'answer' });
  });

  it('buildLive validates channel/title/future time and emits ISO', () => {
    const now = new Date('2026-08-04T10:00:00Z');
    const r = buildLive({ channelId: 'ch1', title: ' Monsoon prep ', scheduledAtLocal: '2026-08-05T18:30' }, now);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.title).toBe('Monsoon prep'); expect(r.value.scheduledAt.endsWith('Z')).toBe(true); }
    expect(buildLive({ channelId: '', title: 'x', scheduledAtLocal: '2026-08-05T18:30' }, now)).toEqual({ ok: false, error: 'channel' });
    expect(buildLive({ channelId: 'c', title: '', scheduledAtLocal: '2026-08-05T18:30' }, now)).toEqual({ ok: false, error: 'title' });
    expect(buildLive({ channelId: 'c', title: 'x', scheduledAtLocal: '2020-01-01T00:00' }, now)).toEqual({ ok: false, error: 'when' });
  });

  it('liveActions mirrors the session state machine', () => {
    expect(liveActions('scheduled')).toEqual(['start', 'cancel']);
    expect(liveActions('live')).toEqual(['end']);
    expect(liveActions('ended')).toEqual([]);
    expect(liveActions('bogus')).toEqual([]);
  });
});
