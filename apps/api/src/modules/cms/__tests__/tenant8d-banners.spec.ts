// modules/cms/__tests__/tenant8d-banners.spec.ts · PC-56 TENANT-8d · THE BANNERS — the pure logic, pinned:
// the state machine (banner.state.ts), the record's rules (banner-rules.ts), the window and the phase (banner-window.ts),
// the audience evaluator (banner-audience.ts), the slot (banner-slot.ts), the acts' verdicts (banner-acts.ts) and the
// form's review (banner-review.ts). Every refusal reachable; every boundary on both sides.
import { BANNER_ACTS, BANNER_STATES, assertTransition, bannerTarget, canTransition, isBannerAct, isBannerState, isEditable, reachesMembers } from '../domain/banner.state';
import {
  AUDIENCE_LIST_MAX, BODY_MAX, CTA_MAX, GROUP_KEY_MAX, HEADLINE_MAX, MAX_REASON, REQUIRED_LANGUAGES, groupKeyIssue, hasMarkup, missingLanguages, normaliseGroupKey, normaliseText,
  orderedLanguages, parseList, parseTargetUrl, reasonIssue,
} from '../domain/banner-rules';
import { bannerPhase, clockIssue, minutesToNextPhase, parseDateOnly, parseWallTime, phaseIsWindowed, wallClock, windowRefusals, ResolvedInstant } from '../domain/banner-window';
import { EVERYONE, MemberFacts, audienceIssues, audienceRule, isEveryone, matchesAudience, reachOf, readAudience, regionContains } from '../domain/banner-audience';
import { nextSlotPlace, orderedSlot, planSlotMove, renumberSlot, slotMoveVerdict, slotPosition } from '../domain/banner-slot';
import { bannerActVerdict, ignoringReason, parseActivationRefusals } from '../domain/banner-acts';
import { BANNER_REVIEW_REFUSALS, BannerReviewInput, CurrentBanner, enteredLanguages, reviewBanner, storedTexts, textField } from '../domain/banner-review';
import { contentToken, decodeCursor } from '../services/banner.service';

describe('TENANT-8d · the state machine (Law 5 — 0178\'s guard is the same table)', () => {
  it('draft → active | archived; active → paused | archived; paused → active | archived; archived final', () => {
    const allowed = BANNER_STATES.flatMap((f) => BANNER_STATES.filter((t) => canTransition(f, t)).map((t) => `${f}>${t}`));
    expect(allowed).toEqual(['draft>active', 'draft>archived', 'active>paused', 'active>archived', 'paused>active', 'paused>archived']);
    expect(() => assertTransition('archived', 'active')).toThrow(); expect(() => assertTransition('draft', 'active')).not.toThrow();
  });
  it('each act from the one state it applies to', () => {
    const t = BANNER_STATES.flatMap((s) => BANNER_ACTS.map((a) => `${s}.${a}=${bannerTarget(s, a)}`));
    expect(t).toEqual([
      'draft.activate=active', 'draft.pause=null', 'draft.resume=null', 'draft.archive=archived',
      'active.activate=null', 'active.pause=paused', 'active.resume=null', 'active.archive=archived',
      'paused.activate=null', 'paused.pause=null', 'paused.resume=active', 'paused.archive=archived',
      'archived.activate=null', 'archived.pause=null', 'archived.resume=null', 'archived.archive=null',
    ]);
    expect(BANNER_STATES.map(isEditable)).toEqual([true, true, true, false]);
    expect(BANNER_ACTS.map(reachesMembers)).toEqual([true, false, true, false]);
    expect([isBannerState('paused'), isBannerState('live'), isBannerState(3), isBannerAct('resume'), isBannerAct('deactivate'), isBannerAct(null)]).toEqual([true, false, false, true, false, false]);
  });
});

describe('TENANT-8d · the record\'s rules', () => {
  it('the required languages are en · hi · gu (0178 banner_required_languages()); missing / ordered', () => {
    expect([...REQUIRED_LANGUAGES]).toEqual(['en', 'hi', 'gu']);
    expect(missingLanguages(['gu'])).toEqual(['en', 'hi']); expect(missingLanguages(['gu', 'hi', 'en', 'mr'])).toEqual([]); expect(missingLanguages([])).toEqual(['en', 'hi', 'gu']);
    expect(orderedLanguages(['mr', 'gu', 'ta', 'en', 'mr'])).toEqual(['en', 'gu', 'mr', 'ta']); expect(orderedLanguages(['ta', 'mr', 'hi'])).toEqual(['hi', 'mr', 'ta']);
  });
  it('text: inner runs collapse, edges trim, blank is null; markup is any < or >', () => {
    expect(normaliseText('  Seeds \n\t in   stock ')).toBe('Seeds in stock'); expect(normaliseText('   ')).toBeNull(); expect(normaliseText(undefined)).toBeNull();
    expect([hasMarkup('a <b> c'), hasMarkup('a > b'), hasMarkup('a < b'), hasMarkup('plain'), hasMarkup(null)]).toEqual([true, true, true, false, false]);
  });
  it('the group key normalises to kebab and is bounded', () => {
    expect(normaliseGroupKey(' Kharif_Seeds  2026!! ')).toBe('kharif-seeds-2026'); expect(normaliseGroupKey('--a--b--')).toBe('a-b'); expect(normaliseGroupKey('!!!')).toBeNull(); expect(normaliseGroupKey(null)).toBeNull();
    expect(groupKeyIssue(null)).toBeNull(); expect(groupKeyIssue('a'.repeat(GROUP_KEY_MAX))).toBeNull(); expect(groupKeyIssue('a'.repeat(GROUP_KEY_MAX + 1))).toBe('GROUP_KEY_TOO_LONG');
    expect(groupKeyIssue('a--b')).toBe('GROUP_KEY_INVALID'); expect(groupKeyIssue('-a')).toBe('GROUP_KEY_INVALID'); expect(groupKeyIssue('Ab')).toBe('GROUP_KEY_INVALID');
  });
  it('the link is https with a host, no whitespace, ≤ 400; empty is no link', () => {
    expect(parseTargetUrl('')).toEqual({ url: null, issue: null }); expect(parseTargetUrl('  ')).toEqual({ url: null, issue: null });
    expect(parseTargetUrl(' https://anand.example/seeds?x=1 ')).toEqual({ url: 'https://anand.example/seeds?x=1', issue: null });
    expect(parseTargetUrl('http://anand.example').issue).toBe('TARGET_NOT_HTTPS'); expect(parseTargetUrl('app://catalogue/seeds').issue).toBe('TARGET_NOT_HTTPS');
    expect(parseTargetUrl('javascript:alert(1)').issue).toBe('TARGET_NOT_HTTPS'); expect(parseTargetUrl('https://a b').issue).toBe('TARGET_INVALID'); expect(parseTargetUrl('not a url').issue).toBe('TARGET_INVALID');
    expect(parseTargetUrl('nope').issue).toBe('TARGET_INVALID'); expect(parseTargetUrl('https://a.example/x y').issue).toBe('TARGET_INVALID'); expect(parseTargetUrl('https://a.example/x\ty').issue).toBe('TARGET_INVALID');
    const long = `https://a.example/${'x'.repeat(400)}`; expect(parseTargetUrl(long).issue).toBe('TARGET_TOO_LONG');
    const edge = `https://a.example/${'x'.repeat(400 - 'https://a.example/'.length)}`; expect(edge.length).toBe(400); expect(parseTargetUrl(edge).issue).toBeNull();
  });
  it('the reason is 3–300 after trimming; lists split on commas and spaces, lower-cased, de-duplicated', () => {
    expect([reasonIssue('ab'), reasonIssue('  ab  '), reasonIssue('abc'), reasonIssue('x'.repeat(MAX_REASON)), reasonIssue('x'.repeat(MAX_REASON + 1)), reasonIssue(null)])
      .toEqual(['REASON_REQUIRED', 'REASON_REQUIRED', null, null, 'REASON_TOO_LONG', 'REASON_REQUIRED']);
    expect(parseList(' Farmer, dairy_farmer  farmer,,worker ')).toEqual(['farmer', 'dairy_farmer', 'worker']); expect(parseList(undefined)).toEqual([]);
  });
});

describe('TENANT-8d · the window and the phase', () => {
  it('dates are real calendar days 2000–2100; times are 24-hour', () => {
    expect([parseDateOnly('2026-02-28'), parseDateOnly('2026-02-29'), parseDateOnly('2028-02-29'), parseDateOnly('2026-13-01'), parseDateOnly('2026-00-10'), parseDateOnly('2026-04-31'), parseDateOnly('1999-12-31'), parseDateOnly('2100-12-31'), parseDateOnly('2101-01-01'), parseDateOnly('2026-1-1'), parseDateOnly(' 2026-07-01 '), parseDateOnly('2026-07-00')])
      .toEqual(['2026-02-28', null, '2028-02-29', null, null, null, null, '2100-12-31', null, null, '2026-07-01', null]);
    expect([parseWallTime('6:00'), parseWallTime('06:05'), parseWallTime('23:59'), parseWallTime('24:00'), parseWallTime('12:60'), parseWallTime('1200'), parseWallTime(undefined), parseWallTime('0:00')])
      .toEqual(['06:00', '06:05', '23:59', null, null, null, null, '00:00']);
    expect(wallClock('2026-07-01', '6:00')).toEqual({ date: '2026-07-01', time: '06:00' }); expect(wallClock('2026-07-01', 'x')).toBeNull(); expect(wallClock('x', '06:00')).toBeNull();
  });
  const at = (iso: string, d: string, t: string): ResolvedInstant => ({ at: new Date(iso), localDate: d, localTime: t });
  const now = new Date('2026-07-10T00:00:00Z');
  it('a wall-clock that does not read back as itself is not on the zone\'s clock (DST gap)', () => {
    expect(clockIssue({ date: '2026-03-08', time: '02:30' }, at('2026-03-08T07:30:00Z', '2026-03-08', '03:30'))).toBe(true);
    expect(clockIssue({ date: '2026-03-08', time: '02:30' }, at('2026-03-08T07:30:00Z', '2026-03-09', '02:30'))).toBe(true);
    expect(clockIssue({ date: '2026-07-01', time: '06:00' }, at('2026-07-01T00:30:00Z', '2026-07-01', '06:00'))).toBe(false);
  });
  it('every window refusal, each on its half', () => {
    const s = { date: '2026-07-01', time: '06:00' }; const e = { date: '2026-07-20', time: '22:00' };
    const S = at('2026-07-01T00:30:00Z', '2026-07-01', '06:00'); const E = at('2026-07-20T16:30:00Z', '2026-07-20', '22:00');
    expect(windowRefusals({ starts: s, ends: e, startsAt: S, endsAt: E, now, requireOpen: true })).toEqual([]);
    expect(windowRefusals({ starts: null, ends: null, startsAt: null, endsAt: null, now, requireOpen: true })).toEqual([{ field: 'startsAt', code: 'STARTS_INVALID' }, { field: 'endsAt', code: 'ENDS_INVALID' }]);
    expect(windowRefusals({ starts: s, ends: e, startsAt: null, endsAt: E, now, requireOpen: true })).toEqual([{ field: 'startsAt', code: 'STARTS_INVALID' }]);
    expect(windowRefusals({ starts: s, ends: e, startsAt: S, endsAt: null, now, requireOpen: true })).toEqual([{ field: 'endsAt', code: 'ENDS_INVALID' }]);
    expect(windowRefusals({ starts: { date: '2026-07-01', time: '07:00' }, ends: { date: '2026-07-20', time: '23:00' }, startsAt: S, endsAt: E, now, requireOpen: true }))
      .toEqual([{ field: 'startsAt', code: 'STARTS_NOT_ON_CLOCK' }, { field: 'endsAt', code: 'ENDS_NOT_ON_CLOCK' }]);
    expect(windowRefusals({ starts: e, ends: s, startsAt: at(E.at.toISOString(), e.date, e.time), endsAt: at(S.at.toISOString(), s.date, s.time), now, requireOpen: true })).toEqual([{ field: 'endsAt', code: 'WINDOW_ORDER' }]);
    expect(windowRefusals({ starts: s, ends: s, startsAt: S, endsAt: S, now, requireOpen: true })).toEqual([{ field: 'endsAt', code: 'WINDOW_ORDER' }]);
    const past = { now: new Date('2026-07-20T16:30:00Z') };
    expect(windowRefusals({ starts: s, ends: e, startsAt: S, endsAt: E, ...past, requireOpen: true })).toEqual([{ field: 'endsAt', code: 'WINDOW_ENDED' }]);
    expect(windowRefusals({ starts: s, ends: e, startsAt: S, endsAt: E, now: new Date('2026-07-20T16:29:59Z'), requireOpen: true })).toEqual([]);
    expect(windowRefusals({ starts: s, ends: e, startsAt: S, endsAt: E, ...past, requireOpen: false })).toEqual([]);
  });
  it('the phase: only an ACTIVE banner is scheduled · live · ended, by [starts, ends)', () => {
    const S = new Date('2026-07-01T00:30:00Z'); const E = new Date('2026-07-20T16:30:00Z');
    expect(bannerPhase('active', S, E, new Date('2026-07-01T00:29:59Z'))).toBe('scheduled');
    expect(bannerPhase('active', S, E, S)).toBe('live');
    expect(bannerPhase('active', S, E, new Date('2026-07-20T16:29:59Z'))).toBe('live');
    expect(bannerPhase('active', S, E, E)).toBe('ended');
    expect(['draft', 'paused', 'archived'].map((st) => bannerPhase(st as any, S, E, now))).toEqual(['draft', 'paused', 'archived']);
    expect(['live', 'scheduled', 'ended', 'draft', 'paused', 'archived'].map((p) => phaseIsWindowed(p as any))).toEqual([true, true, true, false, false, false]);
    expect(minutesToNextPhase('active', S, E, new Date('2026-07-01T00:28:30Z'))).toBe(2);
    expect(minutesToNextPhase('active', S, E, new Date('2026-07-20T16:29:00Z'))).toBe(1);
    expect(minutesToNextPhase('active', S, E, E)).toBeNull(); expect(minutesToNextPhase('paused', S, E, now)).toBeNull();
  });
});

describe('TENANT-8d · the audience — a declared rule, and its evaluator', () => {
  const regions = [{ id: 'r-jun', path: 'IN.GJ.JUN', name: 'Junagadh', level: 2 }, { id: 'r-gj', path: 'IN.GJ', name: 'Gujarat', level: 1 }];
  const pathOf = new Map(regions.map((g) => [g.id, g.path]));
  const m = (roles: string[], regionPaths: string[], languageCode: string | null = 'gu', userId = 'u'): MemberFacts => ({ userId, roles, regionPaths, languageCode });
  it('read / build: lists de-duplicated; a legacy free jsonb reads as what it can vouch for', () => {
    expect(audienceRule(['farmer', 'farmer', 'worker'], ['r', 'r'])).toEqual({ roles: ['farmer', 'worker'], regions: ['r'] });
    expect(readAudience({ roles: ['farmer', 3], regions: 'x', min_orders: 1 })).toEqual({ roles: ['farmer'], regions: [] });
    expect(readAudience(null)).toEqual({ roles: [], regions: [] }); expect(readAudience(['farmer'])).toEqual({ roles: [], regions: [] });
    expect(isEveryone(EVERYONE)).toBe(true); expect(isEveryone({ roles: ['farmer'], regions: [] })).toBe(false); expect(isEveryone({ roles: [], regions: ['r'] })).toBe(false);
  });
  it('validated against the registries, every offending value named', () => {
    expect(audienceIssues({ roles: ['farmer', 'nope'], regions: ['r-jun', 'r-x'] }, ['farmer', 'worker'], regions)).toEqual([{ code: 'ROLE_UNKNOWN', values: ['nope'] }, { code: 'REGION_UNKNOWN', values: ['r-x'] }]);
    expect(audienceIssues({ roles: ['farmer'], regions: ['r-jun'] }, ['farmer'], regions)).toEqual([]);
    const many = Array.from({ length: AUDIENCE_LIST_MAX + 1 }, (_, i) => `r${i}`);
    expect(audienceIssues({ roles: many, regions: [] }, many, regions)).toEqual([{ code: 'AUDIENCE_TOO_MANY', values: [] }]);
    expect(audienceIssues({ roles: many.slice(1), regions: [] }, many, regions)).toEqual([]);
    expect(audienceIssues({ roles: [], regions: many }, [], many.map((id) => ({ id, path: id, name: id, level: 4 })))).toEqual([{ code: 'AUDIENCE_TOO_MANY', values: [] }]);
  });
  it('a region contains itself and what lies under it — by label, never by prefix', () => {
    expect([regionContains('IN.GJ.JUN', 'IN.GJ.JUN'), regionContains('IN.GJ.JUN', 'IN.GJ.JUN.VIS.v1'), regionContains('IN.GJ.JUN', 'IN.GJ.JUNA'), regionContains('IN.GJ.JUN', 'IN.GJ'), regionContains('IN.GJ', 'IN.GJ.JUN')])
      .toEqual([true, true, false, false, true]);
  });
  it('THE EVALUATOR: a role (or any) AND a region in or under one named (or anywhere)', () => {
    expect(matchesAudience(EVERYONE, m([], []), pathOf)).toBe(true);
    expect(matchesAudience({ roles: ['farmer'], regions: [] }, m(['farmer', 'worker'], []), pathOf)).toBe(true);
    expect(matchesAudience({ roles: ['farmer'], regions: [] }, m(['worker'], []), pathOf)).toBe(false);
    expect(matchesAudience({ roles: [], regions: ['r-jun'] }, m(['worker'], ['IN.GJ.JUN.VIS']), pathOf)).toBe(true);
    expect(matchesAudience({ roles: [], regions: ['r-jun'] }, m(['worker'], ['IN.GJ.RAJ']), pathOf)).toBe(false);
    expect(matchesAudience({ roles: [], regions: ['r-jun'] }, m(['worker'], []), pathOf)).toBe(false);          // no address → not "in" Junagadh
    expect(matchesAudience({ roles: [], regions: ['r-jun', 'r-gj'] }, m([], ['IN.GJ.RAJ']), pathOf)).toBe(true);
    expect(matchesAudience({ roles: ['farmer'], regions: ['r-jun'] }, m(['farmer'], ['IN.GJ.RAJ']), pathOf)).toBe(false);
    expect(matchesAudience({ roles: ['farmer'], regions: ['r-jun'] }, m(['worker'], ['IN.GJ.JUN']), pathOf)).toBe(false);
    expect(matchesAudience({ roles: [], regions: ['r-gone'] }, m([], ['IN.GJ.JUN']), pathOf)).toBe(false);       // an id with no path matches nobody
  });
  it('W174 reach: members matched today, by language, and who would not see it (no words in their language)', () => {
    const members = [m(['farmer'], ['IN.GJ.JUN'], 'gu', 'a'), m(['farmer'], ['IN.GJ.JUN.x'], 'gu', 'b'), m(['farmer'], ['IN.GJ.JUN'], 'hi', 'c'), m(['farmer'], ['IN.GJ.JUN'], 'mr', 'd'), m(['worker'], ['IN.GJ.JUN'], 'gu', 'e'), m(['farmer'], ['IN.GJ.JUN'], null, 'f')];
    const r = reachOf({ roles: ['farmer'], regions: ['r-jun'] }, members, pathOf, ['gu', 'hi', 'en']);
    expect(r).toEqual({ matched: 5, considered: 6, hiddenNoText: 2, byLanguage: [{ code: 'gu', members: 2, hasText: true }, { code: '', members: 1, hasText: false }, { code: 'hi', members: 1, hasText: true }, { code: 'mr', members: 1, hasText: false }] });
    expect(reachOf(EVERYONE, [], pathOf, [])).toEqual({ matched: 0, considered: 0, hiddenNoText: 0, byLanguage: [] });
  });
});

describe('TENANT-8d · the slot — order inside a placement, the reorder act', () => {
  const e = (id: string, slotOrder: number) => ({ id, slotOrder });
  it('stored order is place then id; a new banner goes after the LAST place (a gap is not a count)', () => {
    expect(orderedSlot([e('c', 2), e('b', 0), e('a', 0)]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(nextSlotPlace([e('a', 1), e('b', 5)])).toBe(6); expect(nextSlotPlace([])).toBe(1);
    expect([slotPosition([e('a', 1), e('b', 2)], 'b'), slotPosition([e('a', 1)], 'z')]).toEqual([2, null]);
  });
  it('a move is a plan: swap, renumber 1..n, only the changed', () => {
    expect(planSlotMove([e('a', 1), e('b', 2), e('c', 3)], 'c', 'up')).toEqual({ ok: true, order: ['a', 'c', 'b'], steps: [{ id: 'c', from: 3, to: 2 }, { id: 'b', from: 2, to: 3 }] });
    expect(planSlotMove([e('a', 1), e('b', 2)], 'a', 'down')).toEqual({ ok: true, order: ['b', 'a'], steps: [{ id: 'b', from: 2, to: 1 }, { id: 'a', from: 1, to: 2 }] });
    expect(planSlotMove([e('a', 0), e('b', 0), e('c', 0)], 'b', 'down')).toEqual({ ok: true, order: ['a', 'c', 'b'], steps: [{ id: 'a', from: 0, to: 1 }, { id: 'c', from: 0, to: 2 }, { id: 'b', from: 0, to: 3 }] });
    expect(planSlotMove([e('a', 1), e('b', 2)], 'a', 'up')).toEqual({ ok: false, refusal: 'AT_TOP' });
    expect(planSlotMove([e('a', 1), e('b', 2)], 'b', 'down')).toEqual({ ok: false, refusal: 'AT_BOTTOM' });
    expect(planSlotMove([e('a', 1)], 'z', 'up')).toEqual({ ok: false, refusal: 'NOT_IN_SLOT' });
    expect(renumberSlot([e('a', 1)], ['a', 'ghost'])).toEqual([]);
  });
  it('the verdict lists every refusal', () => {
    const entries = [e('a', 1), e('b', 2)];
    expect(slotMoveVerdict({ canManage: true, archived: false, entries, id: 'b', direction: 'up', reason: 'promote the camp' })).toMatchObject({ allowed: true, refusals: [] });
    expect(slotMoveVerdict({ canManage: false, archived: false, entries, id: 'a', direction: 'up', reason: '' }).refusals).toEqual(['NO_PERMISSION', 'AT_TOP', 'REASON_REQUIRED']);
    expect(slotMoveVerdict({ canManage: true, archived: true, entries, id: 'a', direction: 'down', reason: 'x'.repeat(301) })).toMatchObject({ allowed: false, refusals: ['BANNER_ARCHIVED', 'REASON_TOO_LONG'], plan: null });
    expect(slotMoveVerdict({ canManage: true, archived: false, entries, id: 'a', direction: 'down', reason: 'no' })).toMatchObject({ allowed: false, refusals: ['REASON_REQUIRED'] });
  });
});

describe('TENANT-8d · the acts — every reason, and the activation law', () => {
  it('0178\'s refusals parse into codes (once each) and the missing languages', () => {
    expect(parseActivationRefusals(['TEXT_MISSING:hi', 'TEXT_MISSING:gu', 'MEDIA_NOT_CLEAN', 'MEDIA_NOT_CLEAN', 'WAT'])).toEqual({ codes: ['TEXT_MISSING', 'MEDIA_NOT_CLEAN'], missingLanguages: ['hi', 'gu'], unknown: ['WAT'] });
    expect(parseActivationRefusals([])).toEqual({ codes: [], missingLanguages: [], unknown: [] });
    expect(parseActivationRefusals(['TEXT_MISSING'])).toStrictEqual({ codes: ['TEXT_MISSING'], missingLanguages: [], unknown: [] });
    expect(parseActivationRefusals(['MEDIA_NOT_CLEAN:zz']).missingLanguages).toStrictEqual([]);
  });
  const v = (o: Partial<Parameters<typeof bannerActVerdict>[0]>) => bannerActVerdict({ act: 'activate', canManage: true, state: 'draft', reason: 'goes live', activationRefusals: [], ...o });
  it('activate: allowed with the law satisfied; refused with a missing language, a dirty image, an ended window', () => {
    expect(v({})).toEqual({ act: 'activate', allowed: true, refusals: [], to: 'active', missingLanguages: [] });
    expect(v({ activationRefusals: ['TEXT_MISSING:gu', 'MEDIA_NOT_CLEAN', 'WINDOW_ENDED', 'AUDIENCE_INVALID'] })).toMatchObject({ allowed: false, refusals: ['TEXT_MISSING', 'MEDIA_NOT_CLEAN', 'WINDOW_ENDED', 'AUDIENCE_INVALID'], missingLanguages: ['gu'] });
    expect(v({ activationRefusals: ['SOMETHING_NEW'] }).refusals).toEqual(['REFUSED_BY_DATABASE']);
  });
  it('pause and archive ignore the activation law; an act from the wrong state is ILLEGAL and the law is not consulted', () => {
    expect(v({ act: 'pause', state: 'active', activationRefusals: ['TEXT_MISSING:gu'] })).toMatchObject({ allowed: true, to: 'paused', refusals: [] });
    expect(v({ act: 'archive', state: 'paused', activationRefusals: ['MEDIA_NOT_CLEAN'] })).toMatchObject({ allowed: true, to: 'archived' });
    expect(v({ act: 'resume', state: 'paused', activationRefusals: ['MEDIA_NOT_CLEAN'] })).toMatchObject({ allowed: false, refusals: ['MEDIA_NOT_CLEAN'], to: 'active' });
    expect(v({ act: 'activate', state: 'active', activationRefusals: ['TEXT_MISSING:gu'] })).toMatchObject({ allowed: false, refusals: ['ILLEGAL_FROM_STATE'], to: null, missingLanguages: [] });
    expect(v({ act: 'pause', state: 'archived' }).refusals).toEqual(['ILLEGAL_FROM_STATE']);
  });
  it('the permission and the reason, both always judged', () => {
    expect(v({ canManage: false, reason: '' }).refusals).toEqual(['NO_PERMISSION', 'REASON_REQUIRED']);
    expect(v({ act: 'pause', state: 'active', reason: 'x'.repeat(301) }).refusals).toEqual(['REASON_TOO_LONG']);
    const drawn = ignoringReason(v({ reason: '' })); expect(drawn).toMatchObject({ allowed: true, refusals: [] });
    expect(ignoringReason(v({ reason: 'x'.repeat(301) }))).toMatchObject({ allowed: true, refusals: [] });
    expect(ignoringReason(v({ reason: '', canManage: false }))).toMatchObject({ allowed: false, refusals: ['NO_PERMISSION'] });
  });
});

describe('TENANT-8d · the form\'s review (banner-review.ts)', () => {
  const NOW = new Date('2026-06-25T00:00:00Z');
  const S: ResolvedInstant = { at: new Date('2026-07-01T00:30:00Z'), localDate: '2026-07-01', localTime: '06:00' };
  const E: ResolvedInstant = { at: new Date('2026-07-20T16:30:00Z'), localDate: '2026-07-20', localTime: '22:00' };
  const entered = (o: Record<string, string | undefined> = {}) => ({
    placement: 'home_hero', mediaId: 'AAAAAAAA-0000-7000-8000-000000000001', groupKey: 'Kharif Seeds', targetUrl: 'https://anand.example/seeds', roles: 'farmer', regions: 'r-jun',
    startsDate: '2026-07-01', startsTime: '6:00', endsDate: '2026-07-20', endsTime: '22:00', reason: 'kharif seeds arrived',
    headline_gu: 'પ્રમાણિત GG-20 બિયારણ', cta_gu: 'બિયારણ જુઓ', headline_hi: 'प्रमाणित GG-20 बीज', cta_hi: 'बीज देखें', headline_en: 'Certified GG-20 seed', cta_en: 'See seeds', ...o,
  });
  const input = (o: Partial<BannerReviewInput> = {}, e: Record<string, string | undefined> = {}): BannerReviewInput => ({
    canManage: true, intent: 'new', entered: entered(e), languages: ['gu', 'hi', 'en'], strayLanguages: [],
    placements: [{ code: 'home_hero', chosen: true }, { code: 'category_top', chosen: true }, { code: 'old_spot', chosen: false }],
    mediaIssue: null, knownRoles: ['farmer', 'worker'], regions: [{ id: 'r-jun', path: 'IN.GJ.JUN', name: 'Junagadh', level: 2 }],
    startsAt: S, endsAt: E, timezone: 'Asia/Kolkata', now: NOW, current: null, slot: [{ id: 'x', slotOrder: 4 }], writerIssues: [], ...o,
  });
  const codes = (r: ReturnType<typeof reviewBanner>) => r.refusals.map((x) => (x.field ? `${x.field}/${x.code}` : x.code));
  const current = (o: Partial<CurrentBanner> = {}): CurrentBanner => ({
    id: 'b1', state: 'active', placement: 'home_hero', mediaId: 'aaaaaaaa-0000-7000-8000-000000000001', groupKey: 'kharif-seeds', targetUrl: 'https://anand.example/seeds',
    audience: { roles: ['farmer'], regions: ['r-jun'] }, startsAt: S.at, endsAt: E.at, slotOrder: 2, version: 'tok',
    texts: [{ languageCode: 'en', headline: 'Certified GG-20 seed', body: null, ctaLabel: 'See seeds' }, { languageCode: 'gu', headline: 'પ્રમાણિત GG-20 બિયારણ', body: null, ctaLabel: 'બિયારણ જુઓ' }, { languageCode: 'hi', headline: 'प्रमाणित GG-20 बीज', body: null, ctaLabel: 'बीज देखें' }],
    ...o,
  });

  it('a complete create: ready, what will be stored, the slot it joins, activatable, no diff', () => {
    const r = reviewBanner(input());
    expect(codes(r)).toEqual([]); expect(r.ready).toBe(true); expect(r.diff).toBeNull();
    expect(r.preview).toMatchObject({ mode: 'create', state: 'draft', phaseAfter: 'draft', placement: 'home_hero', slotPlace: 5, groupKey: 'kharif-seeds', targetUrl: 'https://anand.example/seeds', missingLanguages: [], activatable: true, liveNow: false, everyone: false, expect: null, timezone: 'Asia/Kolkata' });
    expect(r.preview.texts.map((t) => t.languageCode)).toEqual(['en', 'hi', 'gu']);
    expect(r.preview.startsAt).toEqual(S.at); expect(r.preview.audience).toEqual({ roles: ['farmer'], regions: ['r-jun'] });
    const f = (n: string) => r.fields.find((x) => x.name === n);
    expect(f('mediaId')?.stored).toBe('aaaaaaaa-0000-7000-8000-000000000001'); expect(f('startsAt')).toMatchObject({ entered: '2026-07-01 6:00', stored: '2026-07-01 06:00', normalised: true });
    expect(f('state')?.stored).toBe('draft'); expect(f('slot')?.stored).toBe('5'); expect(f('timezone')?.stored).toBe('Asia/Kolkata'); expect(f('groupKey')?.stored).toBe('kharif-seeds');
    expect(f('roles')?.stored).toBe('farmer'); expect(f('regions')?.stored).toBe('r-jun');
  });
  it('a draft may lack languages — the review says it cannot be activated yet; every word needs a headline', () => {
    const r = reviewBanner(input({}, { headline_hi: undefined, cta_hi: undefined, headline_en: '', cta_en: '' }));
    expect(r.ready).toBe(true); expect(r.preview).toMatchObject({ missingLanguages: ['en', 'hi'], activatable: false });
    expect(codes(reviewBanner(input({}, { headline_gu: '', cta_gu: 'બિયારણ જુઓ' })))).toEqual(['headline_gu/HEADLINE_MISSING']);
    const noHead = reviewBanner(input({}, { headline_gu: '', cta_gu: '', body_gu: 'x' }));
    expect(codes(noHead)).toEqual(['headline_gu/HEADLINE_MISSING']); expect(noHead.fields.find((f) => f.name === 'body_gu')).toMatchObject({ entered: 'x', stored: null });
    const bare = reviewBanner(input({}, { headline_hi: '', cta_hi: '' }));
    expect(bare.fields.filter((f) => f.name.startsWith('headline_')).map((f) => f.name)).toEqual(['headline_en', 'headline_hi', 'headline_gu']);
    expect(codes(reviewBanner(input({}, { headline_gu: '', cta_gu: '', headline_hi: '', cta_hi: '', headline_en: '', cta_en: '' })))).toEqual(['TEXT_REQUIRED']);
  });
  it('the link needs a CTA in every language, and a CTA needs a link', () => {
    expect(codes(reviewBanner(input({}, { cta_hi: '' })))).toEqual(['cta_hi/CTA_REQUIRED']);
    expect(codes(reviewBanner(input({}, { targetUrl: '' })))).toEqual(['cta_en/CTA_WITHOUT_TARGET', 'cta_hi/CTA_WITHOUT_TARGET', 'cta_gu/CTA_WITHOUT_TARGET']);
    expect(codes(reviewBanner(input({}, { targetUrl: '', cta_en: '', cta_hi: '', cta_gu: '' })))).toEqual([]);
    expect(codes(reviewBanner(input({}, { targetUrl: 'app://catalogue/seeds/gg-20' })))).toEqual(['targetUrl/TARGET_NOT_HTTPS']);
  });
  it('plain text, bounded, per part', () => {
    expect(codes(reviewBanner(input({}, { headline_en: 'Seeds <b>now</b>', body_hi: 'a > b' })))).toEqual(['headline_en/TEXT_HAS_MARKUP', 'body_hi/TEXT_HAS_MARKUP']);
    expect(codes(reviewBanner(input({}, { headline_en: 'h'.repeat(HEADLINE_MAX), body_en: 'b'.repeat(BODY_MAX), cta_en: 'c'.repeat(CTA_MAX) })))).toEqual([]);
    expect(codes(reviewBanner(input({}, { headline_en: 'h'.repeat(HEADLINE_MAX + 1), body_en: 'b'.repeat(BODY_MAX + 1), cta_en: 'c'.repeat(CTA_MAX + 1) }))))
      .toEqual(['headline_en/TEXT_TOO_LONG', 'body_en/TEXT_TOO_LONG', 'cta_en/TEXT_TOO_LONG']);
  });
  it('F-8 · the image: required, an id, the cooperative\'s own, an image, clean', () => {
    expect(codes(reviewBanner(input({}, { mediaId: '' })))).toEqual(['mediaId/MEDIA_REQUIRED']);
    expect(codes(reviewBanner(input({ mediaIssue: undefined }, { mediaId: 'hero_gu.webp' })))).toEqual(['mediaId/MEDIA_INVALID']);
    for (const c of ['MEDIA_NOT_YOURS', 'MEDIA_NOT_IMAGE', 'MEDIA_NOT_CLEAN']) expect(codes(reviewBanner(input({ mediaIssue: c })))).toEqual([`mediaId/${c}`]);
    expect(codes(reviewBanner(input({ mediaIssue: 'SOMETHING' })))).toEqual(['mediaId/MEDIA_NOT_YOURS']);
    expect(codes(reviewBanner(input({ mediaIssue: undefined })))).toEqual(['mediaId/MEDIA_NOT_YOURS']);
    expect(reviewBanner(input({ mediaIssue: 'MEDIA_NOT_CLEAN' })).preview.activatable).toBe(false);
  });
  it('Law 6 · the placement from the vocabulary; a retired (legacy) code only on the banner that has it', () => {
    expect(codes(reviewBanner(input({}, { placement: '' })))).toEqual(['placement/PLACEMENT_REQUIRED']);
    expect(codes(reviewBanner(input({}, { placement: 'home-hero' })))).toEqual(['placement/PLACEMENT_UNKNOWN']);
    expect(codes(reviewBanner(input({}, { placement: 'old_spot' })))).toEqual(['placement/PLACEMENT_RETIRED']);
    expect(codes(reviewBanner(input({ intent: 'edit', current: current({ placement: 'old_spot' }) }, { placement: 'old_spot', headline_hi: 'नया' })))).toEqual([]);
    expect(reviewBanner(input({}, { placement: '' })).preview.slotPlace).toBeNull();
  });
  it('the audience against the registries; the group key; the reason; the permission; a stray language', () => {
    expect(codes(reviewBanner(input({}, { roles: 'farmer nope', regions: 'r-jun r-x' })))).toEqual(['roles/ROLE_UNKNOWN', 'regions/REGION_UNKNOWN']);
    const many = Array.from({ length: AUDIENCE_LIST_MAX + 1 }, (_, i) => `role${i}`);
    expect(codes(reviewBanner(input({ knownRoles: many }, { roles: many.join(',') })))).toEqual(['roles/AUDIENCE_TOO_MANY']);
    const regs = many.map((id) => ({ id, path: id, name: id, level: 4 }));
    expect(codes(reviewBanner(input({ regions: regs }, { roles: '', regions: many.join(',') })))).toEqual(['regions/AUDIENCE_TOO_MANY']);
    expect(reviewBanner(input({}, { roles: '', regions: '' })).preview).toMatchObject({ everyone: true, audience: { roles: [], regions: [] } });
    expect(codes(reviewBanner(input({}, { groupKey: 'a'.repeat(70) })))).toEqual(['groupKey/GROUP_KEY_TOO_LONG']);
    expect(codes(reviewBanner(input({}, { reason: 'ok' })))).toEqual(['reason/REASON_REQUIRED']);
    expect(codes(reviewBanner(input({}, { reason: 'x'.repeat(301) })))).toEqual(['reason/REASON_TOO_LONG']);
    expect(codes(reviewBanner(input({ canManage: false })))).toEqual(['NO_PERMISSION']);
    expect(codes(reviewBanner(input({ strayLanguages: ['ta'] })))).toEqual(['LANGUAGE_NOT_OFFERED']);
  });
  it('the window in the tenant\'s zone: invalid halves, order, ended — and an ended window only refused when it moves', () => {
    expect(codes(reviewBanner(input({ startsAt: null, endsAt: null }, { startsDate: '2026-02-30', endsTime: '25:00' })))).toEqual(['startsAt/STARTS_INVALID', 'endsAt/ENDS_INVALID']);
    expect(codes(reviewBanner(input({ startsAt: E, endsAt: S }, { startsDate: '2026-07-20', startsTime: '22:00', endsDate: '2026-07-01', endsTime: '06:00' })))).toEqual(['endsAt/WINDOW_ORDER']);
    const late = new Date('2026-08-01T00:00:00Z');
    expect(codes(reviewBanner(input({ now: late })))).toEqual(['endsAt/WINDOW_ENDED']);
    expect(codes(reviewBanner(input({ now: late, intent: 'edit', current: current() }, { reason: 'fix the hindi line', headline_hi: 'प्रमाणित GG-20 बीज आ गया' })))).toEqual([]);
    const S2: ResolvedInstant = { at: new Date('2026-07-02T00:30:00Z'), localDate: '2026-07-02', localTime: '06:00' };
    const E2: ResolvedInstant = { at: new Date('2026-07-21T16:30:00Z'), localDate: '2026-07-21', localTime: '22:00' };
    expect(codes(reviewBanner(input({ now: late, intent: 'edit', current: current(), startsAt: S2 }, { startsDate: '2026-07-02', reason: 'move the start' })))).toEqual(['endsAt/WINDOW_ENDED']);
    expect(codes(reviewBanner(input({ now: late, intent: 'edit', current: current(), endsAt: E2 }, { endsDate: '2026-07-21', reason: 'move the end' })))).toEqual(['endsAt/WINDOW_ENDED']);
    const r = reviewBanner(input({ startsAt: null }, { startsDate: 'x' }));
    expect(r.fields.find((f) => f.name === 'startsAt')).toMatchObject({ entered: 'x 6:00', stored: null }); expect(r.preview.startsAt).toBeNull();
  });
  it('an edit: the diff against what stands, NOTHING_CHANGED, live at once, the token carried, no required language dropped while active', () => {
    const same = reviewBanner(input({ intent: 'edit', current: current() }, { groupKey: 'kharif-seeds' }));
    expect(codes(same)).toEqual(['NOTHING_CHANGED']); expect(same.diff).toEqual([]);
    const r = reviewBanner(input({ intent: 'edit', current: current() }, { headline_hi: 'प्रमाणित GG-20 बीज आ गया', placement: 'category_top', regions: '' }));
    expect(codes(r)).toEqual([]);
    expect(r.diff).toEqual([{ field: 'placement', before: 'home_hero', after: 'category_top' }, { field: 'regions', before: 'r-jun', after: null }, { field: 'headline_hi', before: 'प्रमाणित GG-20 बीज', after: 'प्रमाणित GG-20 बीज आ गया' }]);
    expect(r.preview).toMatchObject({ mode: 'update', bannerId: 'b1', state: 'active', liveNow: true, expect: 'tok', placementChanged: true, slotPlace: 5, phaseAfter: 'scheduled' });
    expect(reviewBanner(input({ intent: 'edit', current: current() }, { headline_hi: 'नया' })).preview).toMatchObject({ placementChanged: false, slotPlace: 2 });
    expect(codes(reviewBanner(input({ intent: 'edit', current: current() }, { headline_gu: '', cta_gu: '' })))).toEqual(['headline_gu/TEXT_REQUIRED_WHILE_ACTIVE']);
    const paused = reviewBanner(input({ intent: 'edit', current: current({ state: 'paused' }) }, { headline_gu: '', cta_gu: '' }));
    expect(codes(paused)).toEqual([]); expect(paused.preview).toMatchObject({ liveNow: false, state: 'paused', missingLanguages: ['gu'] });
    expect(codes(reviewBanner(input({ intent: 'edit', current: current({ state: 'archived' }) }, { headline_hi: 'नया' })))).toEqual(['STATE_ARCHIVED']);
    expect(reviewBanner(input({ intent: 'edit', current: null })).preview.mode).toBeNull();
    const S2: ResolvedInstant = { at: new Date('2026-07-02T00:30:00Z'), localDate: '2026-07-02', localTime: '06:00' };
    const d = reviewBanner(input({ intent: 'edit', current: current(), startsAt: S2 }, { mediaId: 'bbbbbbbb-0000-7000-8000-000000000001', targetUrl: 'https://anand.example/s2', roles: 'worker', cta_en: 'Go', body_en: 'now', startsDate: '2026-07-02' }));
    expect(codes(d)).toEqual([]); expect(d.diff!.map((x) => x.field)).toEqual(['mediaId', 'targetUrl', 'roles', 'startsAt', 'body_en', 'cta_en']);
    expect(d.diff!.find((x) => x.field === 'startsAt')).toEqual({ field: 'startsAt', before: S.at.toISOString(), after: S2.at.toISOString() });
    expect(codes(reviewBanner(input({ intent: 'edit', current: current() }, { startsDate: '2026-07-02', reason: 'one day later' })))).toEqual(['startsAt/STARTS_NOT_ON_CLOCK', 'NOTHING_CHANGED']);
  });
  it('a language the banner HAS shows its rows even when cleared; texts and entered languages read only the text keys', () => {
    const r = reviewBanner(input({ intent: 'edit', current: current({ state: 'paused', texts: [...current().texts, { languageCode: 'mr', headline: 'बियाणे', body: null, ctaLabel: 'पहा' }] }), languages: ['gu', 'hi', 'en', 'mr'] }));
    expect(r.fields.map((f) => f.name)).toContain('headline_mr');
    expect(r.diff!.map((x) => x.field)).toEqual(['headline_mr', 'cta_mr']);
    expect(storedTexts({ headline_gu: '  a  b ', body_gu: ' ', cta_gu: 'c', headline_ta: 'x' }, ['gu'])).toEqual([{ languageCode: 'gu', headline: 'a b', body: null, ctaLabel: 'c' }]);
    expect(enteredLanguages({ headline_gu: 'a', body_gu: 'c', body_ta: 'b', cta_hi: ' ', reason: 'x', headline_xx1: 'y' })).toEqual(['gu', 'ta']);
    expect(textField('cta', 'gu')).toBe('cta_gu');
  });
  it('the writer\'s belt: a complaint the review has no words for is VALUE_REJECTED / TOO_LONG, never on top of a precise reason', () => {
    expect(codes(reviewBanner(input({ writerIssues: [{ path: 'targetUrl', tooLong: false }, { path: 'groupKey', tooLong: true }] })))).toEqual(['targetUrl/VALUE_REJECTED', 'groupKey/TOO_LONG']);
    expect(codes(reviewBanner(input({ writerIssues: [{ path: 'reason', tooLong: false }] }, { reason: 'no' })))).toEqual(['reason/REASON_REQUIRED']);
    expect(BANNER_REVIEW_REFUSALS).toContain('VALUE_REJECTED');
  });
});

describe('TENANT-8d · the service\'s pure helpers', () => {
  const b = { placement: 'home_hero', mediaId: 'm', targetUrl: null, audience: { roles: [], regions: [] }, startsAt: new Date(0), endsAt: new Date(1000), groupKey: null, state: 'draft' as const };
  const t = [{ languageCode: 'gu', headline: 'a', body: null, ctaLabel: null }, { languageCode: 'en', headline: 'b', body: null, ctaLabel: null }];
  it('the content token changes with what the banner IS, not with the order its words were read in', () => {
    expect(contentToken(b, t)).toBe(contentToken(b, [...t].reverse()));
    expect(contentToken(b, t)).not.toBe(contentToken({ ...b, state: 'active' }, t));
    expect(contentToken(b, t)).not.toBe(contentToken(b, [t[0]]));
    expect(contentToken(b, t)).toHaveLength(24);
  });
  it('the keyset cursor round-trips; anything else is no cursor', () => {
    const c = Buffer.from('2026-07-01T06:00:00.123456+05:30|aaaaaaaa-0000-7000-8000-000000000001').toString('base64url');
    expect(decodeCursor(c)).toEqual({ c: '2026-07-01T06:00:00.123456+05:30', id: 'aaaaaaaa-0000-7000-8000-000000000001' });
    expect(decodeCursor(Buffer.from('x|y').toString('base64url'))).toBeUndefined(); expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(Buffer.from('2026-07-01T06:00:00+00|not-an-id').toString('base64url'))).toBeUndefined();
  });
});
