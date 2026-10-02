// apps/web-tenant/src/test/tenant9b-resolutions.spec.ts · PC-56 TENANT-9b · THE RESOLUTIONS, in the console.
// The helpers; the pages' own promises read from their source (no client JS, no inline handlers, logical CSS, the key minted
// on the review / confirm page, one write path); every list mirrored from the API's OWN source and 0182 (a second copy
// would agree exactly once); and every key a page can ask for exists ×3 with the same {vars} — the literal ones and every
// dynamic family.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACT_REFUSALS, CLOSE_REASONS, DRAFT_FIELDS, DRAFT_REFUSALS, FORMULA_MODES, MAJORITIES, MAX_CARRIED_RESOLUTION, MAX_NOTE, MIN_NOTE, MODE_FIELDS,
  NEW_RESOLUTION_HREF, OUTCOMES, RESOLUTIONS_HREF, RESOLUTIONS_REFUSED_BY_NAME, RESOLUTION_ACTS, RESOLUTION_STATUSES, RESOLUTION_TYPES, RESULT_BASES,
  TRANSPORT_CODES, VOTE_CHOICES, WITHDRAW_REASONS, actHref, actKey, actsFor, basisKey, bpPercent, choiceKey, draftValues, editHref, fieldKey,
  formulaLine, formulaModeKey, govState, isResolutionAct, listFilters, listHref, majorityKey, minorToMajor, outcomeKey, prefillFrom, reasonKey,
  refusalCodesFrom, refusalKey, retryIsMutation, ruleVars, statusKey, typeKey,
} from '../features/governance/resolutions';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const three = (k: string) => { for (const [n, cat] of CATS) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/memberships', rel), 'utf8');
const mig = () => fs.readFileSync(path.join(__dirname, '../../../../db/migrations/0182_resolutions.sql'), 'utf8');
const listOf = (s: string, start: string, end: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf(end, i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]); };
const PAGES = ['app/governance/page.tsx', 'app/governance/resolutions/page.tsx', 'app/governance/resolutions/loading.tsx', 'app/governance/resolutions/actions.ts',
  'app/governance/resolutions/new/page.tsx', 'app/governance/resolutions/new/actions.ts', 'app/governance/resolutions/[id]/act/page.tsx', 'app/governance/resolutions/[id]/act/actions.ts'];

describe('routes (W198, W2741–W2744, W2745–W2747)', () => {
  it('every canon screen has a route; the old /governance write path is gone and the area redirects to W198', () => {
    for (const p of PAGES) expect(fs.existsSync(path.join(__dirname, '..', p))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', 'app/governance/actions.ts'))).toBe(false);
    expect(src('app/governance/page.tsx')).toMatch(/redirect\(RESOLUTIONS_HREF\)/);
    expect([RESOLUTIONS_HREF, NEW_RESOLUTION_HREF]).toEqual(['/governance/resolutions', '/governance/resolutions/new']);
    expect(actHref('a b', 'close')).toBe('/governance/resolutions/a%20b/act?step=confirm&act=close');
    expect(editHref('r1')).toBe('/governance/resolutions/new?step=edit&id=r1');
    expect(src('app/governance/register/page.tsx')).toContain('href="/governance/resolutions"');
  });
  it('the GET-form filters: unknown values are no filter; the cursor rides along', () => {
    expect(listFilters({})).toEqual({});
    expect(listFilters({ status: 'closed', type: 'dividend', year: '2025', cursor: 'abc_-1' })).toEqual({ status: 'closed', type: 'dividend', year: 2025, cursor: 'abc_-1' });
    expect(listFilters({ status: 'activated', type: 'referendum', year: '25', cursor: 'a b' })).toEqual({});
    expect(listFilters({ year: '1999' })).toEqual({});
    expect(listFilters({ status: ['open', 'closed'] })).toEqual({});
    expect(listHref({})).toBe('/governance/resolutions');
    expect(listHref({ status: 'closed', year: 2025 }, 'c2')).toBe('/governance/resolutions?status=closed&year=2025&cursor=c2');
  });
  it('the acts a row offers are the API\'s state machine; Retry is a page load', () => {
    expect([actsFor('draft'), actsFor('open'), actsFor('closed'), actsFor('withdrawn')]).toEqual([['open', 'withdraw'], ['close', 'withdraw'], [], []]);
    const sm = api('domain/resolution.state.ts');
    expect(sm).toContain(`open: { from: ['draft'], to: 'open' }`);
    expect(sm).toContain(`close: { from: ['open'], to: 'closed' }`);
    expect(sm).toContain(`withdraw: { from: ['draft', 'open'], to: 'withdrawn' }`);
    expect(retryIsMutation()).toBe(false);
    expect(isResolutionAct('retry')).toBe(false);
  });
});

describe('the lists are the API\'s own (and 0182\'s)', () => {
  const rules = () => api('domain/resolution-rules.ts');
  it('types, statuses, majorities, acts, outcomes, draft fields, formula modes, mode fields, note bounds', () => {
    expect([...RESOLUTION_TYPES]).toEqual(listOf(rules(), 'RESOLUTION_TYPES = [', '] as const'));
    expect([...RESOLUTION_STATUSES]).toEqual(listOf(rules(), 'RESOLUTION_STATUSES = [', '] as const'));
    expect([...MAJORITIES]).toEqual(listOf(rules(), 'MAJORITIES = [', '] as const'));
    expect([...RESOLUTION_ACTS]).toEqual(listOf(rules(), 'RESOLUTION_ACTS = [', '] as const'));
    expect([...OUTCOMES]).toEqual(listOf(rules(), 'OUTCOMES = [', '] as const'));
    expect([...DRAFT_FIELDS]).toEqual(listOf(rules(), 'DRAFT_FIELDS = [', '] as const'));
    expect([...FORMULA_MODES]).toEqual(listOf(api('domain/coop-payout.rules.ts'), 'FORMULA_MODES = [', '] as const'));
    expect([...RESULT_BASES]).toEqual(listOf(rules(), "export type ResultBasis", ';'));
    for (const m of FORMULA_MODES) expect(MODE_FIELDS[m]).toEqual(listOf(rules(), `  ${m}: [`, ']'));
    expect(MIN_NOTE).toBe(Number(/MIN_NOTE = (\d+)/.exec(rules())![1]));
    expect(MAX_NOTE).toBe(Number(/MAX_NOTE = (\d+)/.exec(rules())![1]));
  });
  it('every refusal the API can return has a code here', () => {
    expect([...DRAFT_REFUSALS]).toEqual(listOf(rules(), 'export type DraftRefusalCode', ';'));
    expect([...ACT_REFUSALS]).toEqual(listOf(rules(), 'export type ActRefusal', ';'));
    expect(api('services/governance.service.ts')).toContain(`code: 'DATABASE_REFUSED'`);
    expect(TRANSPORT_CODES).toContain('DATABASE_REFUSED');
  });
  it('the type CHECK, the reasons and the ballot vocabulary are 0182\'s', () => {
    const sql = mig();
    expect(sql).toContain(`CHECK (resolution_type IN ('${RESOLUTION_TYPES.join("', '")}'))`);
    expect(sql).toContain(`CHECK (status IN ('${RESOLUTION_STATUSES.join("', '")}'))`);
    const of = (t: string) => [...sql.matchAll(new RegExp(`\\('${t}', '([a-z_]+)'`, 'g'))].map((m) => m[1]);
    expect(of('resolution_close_reason')).toEqual([...CLOSE_REASONS]);
    expect(of('resolution_withdraw_reason')).toEqual([...WITHDRAW_REASONS]);
    expect(of('resolution_choice')).toEqual([...VOTE_CHOICES]);
    expect(of('resolution_type')).toEqual([...RESOLUTION_TYPES]);
  });
});

describe('what the page says', () => {
  it('keys — an unknown value is named, never a missing key', () => {
    expect([typeKey('dividend'), typeKey('x'), statusKey('withdrawn'), statusKey('activated')]).toEqual(['res.type.dividend', 'res.type.other', 'res.status.withdrawn', 'res.status.other']);
    expect([outcomeKey('passed'), outcomeKey(null), outcomeKey('maybe'), basisKey('snapshot'), basisKey(undefined)]).toEqual(['res.outcome.passed', 'res.outcome.none', 'res.outcome.none', 'res.basis.snapshot', 'res.basis.none']);
    expect([majorityKey('special'), majorityKey('x'), actKey('close'), actKey('retry'), formulaModeKey('per_share_rate'), formulaModeKey('x')]).toEqual(['res.majority.special', 'res.majority.ordinary', 'res.act.close', 'res.act.other', 'res.formula.per_share_rate', 'res.formula.other']);
    expect([choiceKey('for'), choiceKey('yes'), reasonKey('close', 'agm_declared'), reasonKey('withdraw', 'agm_declared'), reasonKey('open', 'x')]).toEqual(['res.choice.for', 'res.choice.other', 'res.reason.close.agm_declared', 'res.reason.other', 'res.reason.other']);
    expect([refusalKey('SECOND_PERSON_REQUIRED'), refusalKey('FY_NOT_DECLARED'), refusalKey('DATABASE_REFUSED'), refusalKey('evil')]).toEqual(['res.refusal.SECOND_PERSON_REQUIRED', 'res.refusal.FY_NOT_DECLARED', 'res.refusal.DATABASE_REFUSED', 'res.refusal.unknown']);
  });
  it('transport states and the codes a failed write carries', () => {
    expect([govState(undefined, 404, true), govState(undefined, 404), govState('AUDITOR_READ_ONLY'), govState('X', 403), govState('X', 500)]).toEqual(['flaggedOff', 'notFound', 'restricted', 'restricted', 'error']);
    expect(refusalCodesFrom({ refusals: [{ code: 'NOTE_REQUIRED' }, { code: 'NOTE_REQUIRED' }, { code: '<x>' }, {}] }, 'x')).toEqual(['NOTE_REQUIRED']);
    expect(refusalCodesFrom(null, 'GOVERNANCE_REFUSED')).toEqual(['GOVERNANCE_REFUSED']);
    expect(refusalCodesFrom({ refusals: 'no' }, 'unknown')).toEqual(['unknown']);
  });
  it('numbers are printed, never decided: floored percent, unknown stays unknown, money at the currency\'s scale', () => {
    expect([bpPercent(5212), bpPercent(5299), bpPercent(3300), bpPercent(0), bpPercent(null), bpPercent(undefined)]).toEqual(['52%', '52%', '33%', '0%', null, null]);   // floored — 52.99% is not 53%
    expect(ruleVars({ num: 1, den: 2, strict: true })).toEqual({ key: 'res.rule.moreThan', vars: { fraction: '1/2' } });
    expect(ruleVars({ num: 2, den: 3, strict: false })).toEqual({ key: 'res.rule.atLeast', vars: { fraction: '2/3' } });
    expect(ruleVars(null)).toBeNull();
    expect([minorToMajor('250000', 2), minorToMajor('5', 2), minorToMajor('420000', 0), minorToMajor('1.5', 2), minorToMajor('1', 9)]).toEqual(['2500.00', '0.05', '420000', null, null]);
  });
  it('W198\'s formula line — "1.2% of member\'s FY sales, cap ₹2,500/member", with the ISO code, never a glyph', () => {
    const inr = { code: 'INR', minorUnits: 2 };
    expect(formulaLine({ mode: 'patronage_pct', rateBp: 120, capMinor: '250000', fiscalYear: 2025, currencyCode: 'INR' }, inr))
      .toEqual({ key: 'res.formulaLine.patronage_pct_cap', vars: { rate: '1.2%', fy: '2025', cap: 'INR 2500.00' } });
    expect(formulaLine({ mode: 'patronage_pct', rateBp: 120, capMinor: null, fiscalYear: 2025 }, inr)).toEqual({ key: 'res.formulaLine.patronage_pct', vars: { rate: '1.2%', fy: '2025' } });
    expect(formulaLine({ mode: 'per_share_rate', rateBp: 800 }, inr)).toEqual({ key: 'res.formulaLine.per_share_rate', vars: { rate: '8%' } });
    expect(formulaLine({ mode: 'per_share_rate', rateBp: 1050 }, inr)).toEqual({ key: 'res.formulaLine.per_share_rate', vars: { rate: '10.5%' } });
    expect(formulaLine({ mode: 'equal_split', potMinor: '42000000', currencyCode: 'INR' }, inr)).toEqual({ key: 'res.formulaLine.equal_split', vars: { pot: 'INR 420000.00' } });
    expect(formulaLine({}, inr)).toBeNull();
    expect(formulaLine(null, inr)).toBeNull();
    expect(formulaLine({ mode: 'equal_split', potMinor: '100' }, null)).toBeNull();
  });
  it('the edit prefill and the carried values', () => {
    expect(prefillFrom({ title: 'T', body: null, resolutionType: 'patronage_bonus', majority: 'ordinary', votingOpens: null, votingCloses: '2026-07-19T18:00',
      payload: { mode: 'patronage_pct', rateBp: 120, capMinor: '250000', fiscalYear: 2025 } }, { code: 'INR', minorUnits: 2 }))
      .toEqual({ title: 'T', body: '', resolutionType: 'patronage_bonus', majority: 'ordinary', votingOpens: '', votingCloses: '2026-07-19T18:00', formulaMode: 'patronage_pct', potAmount: '', ratePct: '1.2', capAmount: '2500.00', fiscalYear: '2025' });
    expect(prefillFrom({ title: 'D', body: 'b', resolutionType: 'dividend', majority: 'special', votingOpens: null, votingCloses: null, payload: { mode: 'per_share_rate', rateBp: 800 } }, null).ratePct).toBe('8');
    const v = draftValues({ title: 'x', body: 'y'.repeat(20_000), evil: 'z', ratePct: ['1', '2'] });
    expect(Object.keys(v)).toEqual([...DRAFT_FIELDS]);
    expect([v.title, v.body.length, v.ratePct]).toEqual(['x', 10_000, '']);
    expect(MAX_CARRIED_RESOLUTION).toBeGreaterThan(10_000);
  });
});

describe('the pages keep their promises', () => {
  const tsx = PAGES.filter((p) => p.endsWith('.tsx'));
  it('server components only, no inline handlers, logical CSS', () => {
    for (const p of tsx) {
      const s = src(p);
      expect([p, s.includes("'use client'")]).toEqual([p, false]);
      expect([p, /\son[A-Z][a-zA-Z]+=\{/.test(s)]).toEqual([p, false]);
      expect([p, /(margin|padding)-(left|right)|text-align:\s*(left|right)|\bleft:|\bright:/.test(s)]).toEqual([p, false]);
    }
  });
  it('every write carries the key its page minted (the review page, the confirm page) — never one minted per submit', () => {
    expect(src('app/governance/resolutions/new/page.tsx')).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    expect(src('app/governance/resolutions/[id]/act/page.tsx')).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    for (const a of ['app/governance/resolutions/new/actions.ts', 'app/governance/resolutions/[id]/act/actions.ts']) expect(src(a)).toMatch(/formData\.get\('idempotencyKey'\)/);
  });
  it('the note never travels in a success URL; the console casts no vote for anybody (no member parameter)', () => {
    expect(src('app/governance/resolutions/[id]/act/actions.ts')).not.toMatch(/done\.set\('note'/);
    const vote = src('app/governance/resolutions/actions.ts').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(vote).toMatch(/castVote\(id, choice\)/);
    expect(vote).not.toMatch(/memberUserId|onBehalf|userId/);
  });
  it('a CLOSED row prints its snapshot or "not recorded" — the page never computes a result', () => {
    const p = src('app/governance/resolutions/page.tsx');
    expect(p).toContain('r.result.outcome');
    expect(p).toContain("res.turnout.notRecorded");
    expect(p).not.toMatch(/inFavour\s*\*\s*2|passed\s*=/);
  });
  it('the canon\'s unbacked promises are refused by name, each on a page that draws it', () => {
    for (const r of RESOLUTIONS_REFUSED_BY_NAME) three(`res.refused.${r}`);
    const all = PAGES.map(src).join('\n');
    for (const r of RESOLUTIONS_REFUSED_BY_NAME) expect([r, all.includes(`res.refused.${r}`)]).toEqual([r, true]);
  });
});

describe('i18n — every key a page can ask for, ×3, with the same {vars}', () => {
  it('the literal keys', () => {
    for (const p of PAGES) for (const m of src(p).matchAll(/t\.t\('([a-zA-Z0-9_.]+)'/g)) three(m[1]);
  });
  it('every dynamic family', () => {
    for (const x of [...RESOLUTION_TYPES, 'other']) three(`res.type.${x}`);
    for (const x of [...RESOLUTION_STATUSES, 'other']) three(`res.status.${x}`);
    for (const x of [...OUTCOMES, 'none']) three(`res.outcome.${x}`);
    for (const x of RESULT_BASES) three(`res.basis.${x}`);
    for (const x of MAJORITIES) three(`res.majority.${x}`);
    for (const x of [...RESOLUTION_ACTS, 'other']) { three(`res.act.${x}`); }
    for (const x of RESOLUTION_ACTS) { three(`res.act.rule.${x}`); three(`res.act.done.${x}`); }
    for (const x of [...FORMULA_MODES, 'other']) three(`res.formula.${x}`);
    for (const x of [...FORMULA_MODES, 'none']) three(`res.form.modeHint.${x}`);
    for (const x of ['equal_split', 'patronage_pro_rata', 'per_share_rate', 'patronage_pct', 'patronage_pct_cap']) three(`res.formulaLine.${x}`);
    for (const x of [...VOTE_CHOICES, 'other']) three(choiceKey(x));
    for (const x of CLOSE_REASONS) three(reasonKey('close', x));
    for (const x of WITHDRAW_REASONS) three(reasonKey('withdraw', x));
    three('res.reason.other');
    for (const x of [...DRAFT_FIELDS, 'formula']) three(fieldKey(x));
    for (const x of [...DRAFT_REFUSALS, ...ACT_REFUSALS, ...TRANSPORT_CODES]) three(refusalKey(x));
    for (const st of ['flaggedOff', 'restricted', 'notFound', 'error']) { three(`res.state.${st}.title`); three(`res.state.${st}.body`); }
    for (const x of ['voted', 'changed']) three(`res.ok.${x}`);
    for (const x of ['undeclared', 'notOpen', 'ineligible', 'generic']) three(`res.voteError.${x}`);
    for (const x of ['moreThan', 'atLeast', 'fixedAtOpen', 'fixedLater', 'fixedAtClose']) three(`res.rule.${x}`);
  });
  it('every res.* key has the same {vars} in all three languages, and none is blank', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('res.'));
    expect(keys.length).toBeGreaterThan(240);
    for (const k of keys) {
      const e = String(en[k as keyof typeof en]); const h = String(hi[k as keyof typeof hi] ?? ''); const g = String(gu[k as keyof typeof gu] ?? '');
      expect([k, vars(h), vars(g)]).toEqual([k, vars(e), vars(e)]);
      expect([k, e.trim().length > 0 && h.trim().length > 0 && g.trim().length > 0]).toEqual([k, true]);
    }
  });
});
