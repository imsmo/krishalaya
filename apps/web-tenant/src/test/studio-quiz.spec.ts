import { buildLive, liveActions } from '../features/studio/quiz';

// PC-56 TENANT-7b: the plain-text quiz parser and its round-trip contract left this file with the text format — the
// quiz is authored through the API-reviewed question chain now (test/tenant7b-lessons.spec.ts).

describe('features/studio/quiz (PC-26b)', () => {
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
