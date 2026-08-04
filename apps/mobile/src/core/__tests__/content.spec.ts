// Unit tests for the PURE tips/crop-hub/assistant/voice logic (features/content/content). No React/native deps
// (SDK/ui types are type-only). Covers local search (ReDoS-safe), kind grouping/labels, saved-tips set math, and
// assistant input validation. The server stays the authority on which resources exist + on AI answers.
import {
  RESOURCE_KINDS, kindLabelKey, kindTone, normalizeQuery, matchesQuery, searchResources,
  groupByKind, tipSnapshot, isSaved, toggleSaved, reconcileSavedTips, buildAssistantDraft, appendTurn, type TipSnapshot, type ChatTurn,
  readTimeMinutes, languageLabelKey, TIP_CATEGORIES, relatedTips, shouldShowAssistantMic,
} from '../../features/content/content';
import type { LearningResource } from '@krishalaya/sdk-js';

describe('relatedTips (real catalogue, never fabricated)', () => {
  const r = (id: string, kind: LearningResource['kind']) => ({ id, kind });
  const all = [r('a', 'article'), r('b', 'video'), r('c', 'article'), r('d', 'post'), r('e', 'article')];
  it('excludes the current tip and caps at max', () => {
    const out = relatedTips(all, 'a', 3);
    expect(out.map((x) => x.id)).not.toContain('a');
    expect(out).toHaveLength(3);
  });
  it('prefers same-kind first, then fills with others', () => {
    const out = relatedTips(all, 'a', 4);
    // same-kind (article: c,e) come before others (b,d)
    expect(out.map((x) => x.id)).toEqual(['c', 'e', 'b', 'd']);
  });
  it('handles unknown id and tiny lists', () => {
    expect(relatedTips(all, 'zzz', 2).map((x) => x.id)).toEqual(['a', 'b']);
    expect(relatedTips([], 'a')).toHaveLength(0);
  });
});

describe('readTimeMinutes (derived from real body)', () => {
  it('estimates minutes ≥1; empty/whitespace → 1', () => {
    expect(readTimeMinutes('')).toBe(1);
    expect(readTimeMinutes(null)).toBe(1);
    expect(readTimeMinutes('   ')).toBe(1);
    expect(readTimeMinutes('one two three')).toBe(1);
    expect(readTimeMinutes(Array(401).fill('w').join(' '))).toBe(3); // ceil(401/200)
  });
});

describe('languageLabelKey', () => {
  it('maps hi/en/gu (case-insensitive); unknown/empty → other', () => {
    expect(languageLabelKey('hi')).toBe('hi');
    expect(languageLabelKey('EN')).toBe('en');
    expect(languageLabelKey('gu')).toBe('gu');
    expect(languageLabelKey('fr')).toBe('other');
    expect(languageLabelKey(null)).toBe('other');
  });
});

describe('TIP_CATEGORIES', () => {
  it('starts with all + carries the design topic chips', () => {
    expect(TIP_CATEGORIES[0]).toBe('all');
    expect(TIP_CATEGORIES).toContain('pest');
    expect(TIP_CATEGORIES).toHaveLength(5);
  });
});

const res = (over: Partial<LearningResource>): LearningResource => ({
  id: 'r1', channelId: null, ownerUserId: 'u1', kind: 'article', title: 'Tomato care',
  externalUrl: null, mediaId: null, topicId: null, languageCode: null, body: 'Water daily', status: 'approved', ...over,
});

describe('kindLabelKey / kindTone', () => {
  it('maps known kinds and falls back', () => {
    expect(kindLabelKey('video')).toBe('content.kind.video');
    expect(kindLabelKey('weird')).toBe('content.kind.other');
    expect(kindTone('video')).toBe('info');
    expect(kindTone('audio')).toBe('accent');
    expect(kindTone('article')).toBe('success');
    expect(kindTone('post')).toBe('neutral');
  });
});

describe('normalizeQuery', () => {
  it('trims, collapses whitespace, lowercases, caps length', () => {
    expect(normalizeQuery('  Hello   World ')).toBe('hello world');
    expect(normalizeQuery(null)).toBe('');
    expect(normalizeQuery('x'.repeat(200)).length).toBe(120);
  });
});

describe('matchesQuery / searchResources', () => {
  it('matches title or body, case-insensitive; empty query matches all', () => {
    expect(matchesQuery(res({ title: 'Tomato' }), 'tom')).toBe(true);
    expect(matchesQuery(res({ title: 'Wheat', body: 'irrigation' }), 'IRRIG')).toBe(true);
    expect(matchesQuery(res({ title: 'Wheat', body: null }), 'rice')).toBe(false);
    expect(matchesQuery(res({}), '')).toBe(true);
  });
  it('filters a list, preserving order; empty query returns all', () => {
    const list = [res({ id: 'a', title: 'Rice' }), res({ id: 'b', title: 'Tomato' })];
    expect(searchResources(list, 'rice').map((r) => r.id)).toEqual(['a']);
    expect(searchResources(list, '').length).toBe(2);
  });
  it('treats user input as a literal (no regex injection / ReDoS)', () => {
    expect(matchesQuery(res({ title: 'a.b' }), '.*')).toBe(false);
  });
});

describe('groupByKind', () => {
  it('groups into ordered sections, dropping empty kinds', () => {
    const list = [res({ id: 'a', kind: 'video' }), res({ id: 'b', kind: 'article' }), res({ id: 'c', kind: 'video' })];
    const secs = groupByKind(list);
    expect(secs.map((s) => s.kind)).toEqual(['article', 'video']); // RESOURCE_KINDS order, empties dropped
    expect(secs.find((s) => s.kind === 'video')!.items.length).toBe(2);
  });
  it('RESOURCE_KINDS is the canonical order', () => {
    expect(RESOURCE_KINDS[0]).toBe('article');
  });
});

describe('saved-tips set math', () => {
  const snap = (id: string): TipSnapshot => ({ id, title: `t${id}`, kind: 'article', savedAt: 1 });
  it('tipSnapshot captures a minimal record', () => {
    expect(tipSnapshot(res({ id: 'x', title: 'Y', kind: 'blog' }), 99)).toEqual({ id: 'x', title: 'Y', kind: 'blog', savedAt: 99 });
  });
  it('toggle adds (newest first) then removes; isSaved reflects it', () => {
    let saved: TipSnapshot[] = [];
    saved = toggleSaved(saved, snap('a'));
    expect(isSaved(saved, 'a')).toBe(true);
    saved = toggleSaved(saved, snap('b'));
    expect(saved.map((s) => s.id)).toEqual(['b', 'a']);
    saved = toggleSaved(saved, snap('a'));
    expect(isSaved(saved, 'a')).toBe(false);
  });
  it('caps the list', () => {
    let saved: TipSnapshot[] = [];
    for (let i = 0; i < 5; i++) saved = toggleSaved(saved, snap(`s${i}`), 3);
    expect(saved.length).toBe(3);
  });
  it('reconcileSavedTips: server is authoritative — drops removed, adds server-only, keeps local title', () => {
    const local: TipSnapshot[] = [{ id: 'a', title: 'Aphids', kind: 'article', savedAt: 30 }, { id: 'b', title: 'Blight', kind: 'blog', savedAt: 20 }];
    const merged = reconcileSavedTips(local, ['a', 'c'], 10);
    expect(merged.map((s) => s.id)).toEqual(['a', 'c']);            // 'b' dropped (server removed), 'c' added
    expect(merged.find((s) => s.id === 'a')!.title).toBe('Aphids'); // local snapshot title preserved
    expect(merged.find((s) => s.id === 'c')!.title).toBe('c');      // server-only placeholder (resolves on detail)
  });
});

describe('buildAssistantDraft', () => {
  it('assembles a valid payload (trimmed) in a launch language', () => {
    const d = buildAssistantDraft({ text: '  How to treat blight? ', lang: 'hi', sessionId: 's1' });
    expect(d.ok).toBe(true);
    expect(d.input).toEqual({ message: 'How to treat blight?', languageCode: 'hi', sessionId: 's1' });
  });
  it('rejects empty message and non-launch language', () => {
    expect(buildAssistantDraft({ text: '   ', lang: 'en' }).reason).toBe('empty');
    expect(buildAssistantDraft({ text: 'hi', lang: 'fr' }).reason).toBe('lang');
  });
  it('defaults sessionId to undefined when absent', () => {
    expect(buildAssistantDraft({ text: 'q', lang: 'gu' }).input?.sessionId).toBeUndefined();
  });
});

describe('shouldShowAssistantMic (R2-03: mic flag-gated, text composer never is)', () => {
  it('mirrors the voice_assistant flag exactly', () => {
    expect(shouldShowAssistantMic(false)).toBe(false);
    expect(shouldShowAssistantMic(true)).toBe(true);
  });
});

describe('appendTurn', () => {
  const turn = (id: string): ChatTurn => ({ id, role: 'user', text: id, at: 1 });
  it('appends and bounds the transcript', () => {
    let t: ChatTurn[] = [];
    for (let i = 0; i < 5; i++) t = appendTurn(t, turn(`t${i}`), 3);
    expect(t.length).toBe(3);
    expect(t.map((x) => x.id)).toEqual(['t2', 't3', 't4']);
  });
  it('preserves an assistant turn\'s server citations verbatim', () => {
    const ai: ChatTurn = { id: 'a1', role: 'assistant', text: 'hi', at: 2, citations: [{ title: 'ICAR Manual', url: 'https://x' }] };
    const out = appendTurn([], ai);
    expect(out[0].citations).toEqual([{ title: 'ICAR Manual', url: 'https://x' }]);
  });
});
