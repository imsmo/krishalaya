// apps/web-tenant/src/test/tenant9d-esg.spec.ts · PC-56 TENANT-9d · ESG, in the console.
// The helpers (the console's half of the gate: no figure without `published_with_fact` AND a fact); the pages' own promises
// read from their source (server components, no inline handlers, logical CSS, the key minted on the review / confirm / report
// page); every list mirrored from the API's OWN source and 0183; and every key a page can ask for exists ×3 with the same {vars}.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACT_REFUSALS, DASHBOARD_REFUSALS, DISCLOSURE_ACTS, DISCLOSURE_REFUSALS, DISCLOSURE_STATUSES, ESG_HREF, ESG_REFUSED_BY_NAME, MAX_NOTE, MAX_TEXT, METRIC_CODES,
  MIN_NOTE, MIN_TEXT, NEW_DISCLOSURE_HREF, PILLARS, REPORT_HREF, REPORT_REFUSED_BY_NAME, TRANSPORT_CODES, VERDICTS, WITHDRAW_REASONS, actHref, actKey,
  byNameKey, carriedFrom, civilLabel, disclosureValues, editDisclosureHref, esgState, exportHref, factLines, isDisclosureAct, methodHref, newDisclosureHref,
  noValueKey, pick, pillarKey, reasonKey, refusalKey, retryIsMutation, statusKey, valueShown, verdictKey,
} from '../features/esg/esg';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const three = (k: string) => { for (const [n, cat] of CATS) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/esg', rel), 'utf8');
const mig = () => fs.readFileSync(path.join(__dirname, '../../../../db/migrations/0183_esg.sql'), 'utf8');
const listOf = (s: string, start: string, end: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf(end, i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]); };
const PAGES = ['app/esg/page.tsx', 'app/esg/loading.tsx', 'app/esg/dashboard/page.tsx', 'app/esg/methods/[code]/page.tsx', 'app/esg/report/page.tsx', 'app/esg/report/actions.ts',
  'app/esg/report/exports/[id]/page.tsx', 'app/esg/report/exports/[id]/actions.ts', 'app/esg/report/exports/[id]/download/route.ts',
  'app/esg/disclosures/new/page.tsx', 'app/esg/disclosures/new/actions.ts', 'app/esg/disclosures/[id]/act/page.tsx', 'app/esg/disclosures/[id]/act/actions.ts'];

const row = (over: Record<string, unknown> = {}) => ({ verdict: 'published_with_fact', fact: { kind: 'audit_trail', appendOnly: true, canInsert: true, canUpdate: false, canDelete: false, canTruncate: false, hashColumns: [], ledgerChained: true, asOf: '2026-10-02T09:00' }, ...over }) as never;

describe('routes (W423, W424, W2598–W2601, W2602–W2604) and the method pages', () => {
  it('every canon screen has a route; the canon slug esg/dashboard redirects to the area', () => {
    for (const p of PAGES) expect([p, fs.existsSync(path.join(__dirname, '..', p))]).toEqual([p, true]);
    expect(src('app/esg/dashboard/page.tsx')).toMatch(/redirect\(ESG_HREF\)/);
    expect([ESG_HREF, REPORT_HREF, NEW_DISCLOSURE_HREF]).toEqual(['/esg', '/esg/report', '/esg/disclosures/new']);
    expect(methodHref('one_member_one_vote')).toBe('/esg/methods/one_member_one_vote');
    expect(actHref('a b', 'publish')).toBe('/esg/disclosures/a%20b/act?step=confirm&act=publish');
    expect(newDisclosureHref('adulteration')).toBe('/esg/disclosures/new?step=edit&metricCode=adulteration');
    expect(editDisclosureHref('d1')).toBe('/esg/disclosures/new?step=edit&id=d1');
    expect(exportHref('j1')).toBe('/esg/report/exports/j1');
    expect(src('components/Sidebar.tsx')).toContain("env.featureEsg ? [{ key: 'esg', href: '/esg'");
  });
});

describe('the console\'s half of the gate', () => {
  it('a figure only for published_with_fact WITH a fact — every other verdict is a sentence, never 0', () => {
    expect(valueShown(row())).toBe(true);
    expect(valueShown(row({ fact: null }))).toBe(false);
    for (const v of ['published_no_fact', 'no_method', 'no_programme']) expect(valueShown(row({ verdict: v }))).toBe(false);
    expect([noValueKey('no_method'), noValueKey('no_programme'), noValueKey('published_no_fact'), noValueKey('published_with_fact'), noValueKey('nonsense')])
      .toEqual(['esg.value.no_method', 'esg.value.no_programme', 'esg.value.published_no_fact', 'esg.value.published_no_fact', 'esg.value.published_no_fact']);
    const p = src('app/esg/page.tsx');
    expect(p).toContain('valueShown(r) && r.fact');
    expect(p).toContain('t.t(noValueKey(r.verdict))');
    expect(p).not.toMatch(/\?\?\s*0\b|\|\|\s*0\b/);
  });
  it('the figure as sentences — numbers through the page\'s formatter, never decided here', () => {
    const fmt = (n: number) => `#${n}`;
    expect(factLines({ kind: 'omov', closedWithSnapshot: 2, ballots: 7, eligibleAtClose: 10, maxBallotsPerMember: 1, overRoll: 0, notRecordedCloses: 1, asOf: null }, fmt))
      .toEqual([{ key: 'esg.fact.omov.main', vars: { closed: '#2', ballots: '#7', eligible: '#10' } }, { key: 'esg.fact.omov.max', vars: { max: '#1' } }, { key: 'esg.fact.omov.notRecorded', vars: { n: '#1' } }]);
    expect(factLines({ kind: 'adulteration', windowDays: 30, from: 'f', to: 't', pours: 4, flaggedPours: 0, waterFlagged: 0, reviewsOpened: 0, retested: 0, lastFlaggedDay: null, asOf: null }, fmt).map((l) => l.key))
      .toEqual(['esg.fact.adulteration.main', 'esg.fact.adulteration.retests', 'esg.fact.adulteration.none']);
    expect(factLines({ kind: 'audit_trail', appendOnly: false, canInsert: true, canUpdate: true, canDelete: false, canTruncate: false, hashColumns: ['h'], ledgerChained: false, asOf: null }, fmt).map((l) => l.key))
      .toEqual(['esg.fact.audit.notAppendOnly', 'esg.fact.audit.hashColumns', 'esg.fact.audit.ledgerNotChained']);
    expect([civilLabel('2026-10-02T06:15'), civilLabel('2026-10-02'), civilLabel('junk'), civilLabel(null)]).toEqual(['2026-10-02 06:15', '2026-10-02', null, null]);
    expect([pick({ en: 'x', gu: 'ગ' }, 'gu'), pick({ en: 'x' }, 'hi'), pick(null, 'en')]).toEqual(['ગ', 'x', null]);
  });
  it('the states; Retry is a page load; the form\'s values in the URL', () => {
    expect([esgState(undefined, 403), esgState(undefined, 404, true), esgState(undefined, 404), esgState('X', 500), esgState('AUDITOR_READ_ONLY')]).toEqual(['restricted', 'flaggedOff', 'notFound', 'error', 'restricted']);
    expect(retryIsMutation()).toBe(false);
    expect(isDisclosureAct('retry')).toBe(false);
    expect(disclosureValues({ metricCode: 'adulteration', text_en: 'words', text_gu: ' ', text_mr: 'x', extra: 'y' }, ['en', 'hi', 'gu'])).toEqual({ metricCode: 'adulteration', texts: { en: 'words' } });
    expect(disclosureValues({ metricCode: 'DROP TABLE' }, ['en'])).toEqual({ metricCode: '', texts: {} });
    expect(carriedFrom({ metricCode: 'adulteration', texts: { en: 'w', gu: 'ગ' } })).toEqual({ metricCode: 'adulteration', text_en: 'w', text_gu: 'ગ' });
  });
});

describe('the lists are the API\'s own (and 0183\'s)', () => {
  const rules = () => api('domain/esg-rules.ts');
  it('metrics, pillars, verdicts, statuses, acts, bounds, refusals, the by-name list', () => {
    expect([...METRIC_CODES]).toEqual(listOf(rules(), 'METRIC_CODES = [', '] as const'));
    expect([...PILLARS]).toEqual(listOf(rules(), 'PILLARS = [', '] as const'));
    expect([...VERDICTS]).toEqual(listOf(rules(), 'VERDICTS = [', '] as const'));
    expect([...DISCLOSURE_STATUSES]).toEqual(listOf(rules(), 'DISCLOSURE_STATUSES = [', '] as const'));
    expect([...DISCLOSURE_ACTS]).toEqual(listOf(api('domain/esg-disclosure.state.ts'), 'DISCLOSURE_ACTS = [', '] as const'));
    expect([...DISCLOSURE_REFUSALS]).toEqual(listOf(rules(), 'export type DisclosureRefusalCode', ';'));
    expect([...ACT_REFUSALS]).toEqual(listOf(rules(), 'export type DisclosureActRefusal', ';'));
    expect([...ESG_REFUSED_BY_NAME]).toEqual(listOf(rules(), 'ESG_REFUSED_BY_NAME = [', '] as const'));
    expect([...REPORT_REFUSED_BY_NAME]).toEqual(listOf(api('services/esg.service.ts'), 'REPORT_REFUSED_BY_NAME = [', '] as const'));
    for (const r of DASHBOARD_REFUSALS) expect(ESG_REFUSED_BY_NAME).toContain(r);
    for (const [k, v] of [['MIN_TEXT', MIN_TEXT], ['MAX_TEXT', MAX_TEXT], ['MIN_NOTE', MIN_NOTE], ['MAX_NOTE', MAX_NOTE]] as const) expect(v).toBe(Number(new RegExp(`${k} = (\\d+)`).exec(rules())![1]));
    expect(api('services/esg.service.ts')).toContain(`code: 'DATABASE_REFUSED'`);
    expect(TRANSPORT_CODES).toContain('DATABASE_REFUSED');
  });
  it('the withdraw reasons are 0183\'s', () => {
    expect([...WITHDRAW_REASONS]).toEqual([...mig().matchAll(/\('esg_disclosure_withdraw_reason', '([a-z_]+)'/g)].map((m) => m[1]));
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
  it('every write carries the key its page minted — the review page, the confirm page, the report page', () => {
    for (const p of ['app/esg/disclosures/new/page.tsx', 'app/esg/disclosures/[id]/act/page.tsx', 'app/esg/report/page.tsx']) expect(src(p)).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    for (const a of ['app/esg/disclosures/new/actions.ts', 'app/esg/disclosures/[id]/act/actions.ts', 'app/esg/report/actions.ts']) expect(src(a)).toMatch(/formData\.get\('idempotencyKey'\)/);
  });
  it('the note never travels in a success URL; the page states the file is unsigned; the audit row is corrected', () => {
    expect(src('app/esg/disclosures/[id]/act/actions.ts')).not.toMatch(/note=|set\('note'/);
    expect(src('app/esg/report/page.tsx')).toContain("t.t('esg.report.unsigned')");
    expect(src('app/esg/report/exports/[id]/page.tsx')).toContain("t.t('esg.report.unsigned')");
    expect(en['esg.byName.hashChainedTrail' as keyof typeof en]).toMatch(/append-only, not hash-chained/);
    expect(en['esg.value.no_programme' as keyof typeof en]).not.toMatch(/\d/);
  });
  it('the canon\'s unbacked promises are refused by name, each on a page that draws it', () => {
    const all = PAGES.map(src).join('\n');
    expect(all).toContain('DASHBOARD_REFUSALS.map'); expect(all).toContain('REPORT_REFUSED_BY_NAME');
    expect(all).toContain("byNameKey('methodEditing')"); expect(all).toContain("byNameKey('retry')");
    for (const r of ESG_REFUSED_BY_NAME) three(byNameKey(r));
  });
});

describe('i18n — every key a page can ask for, ×3, with the same {vars}', () => {
  it('the literal keys', () => {
    for (const p of PAGES) for (const m of src(p).matchAll(/t\.t\('([a-zA-Z0-9_.]+)'/g)) three(m[1]);
    three('nav.esg');
  });
  it('every dynamic family', () => {
    for (const x of [...PILLARS, 'other']) three(pillarKey(x));
    for (const x of [...VERDICTS, 'unknown']) three(verdictKey(x));
    for (const x of ['published_no_fact', 'no_method', 'no_programme']) three(noValueKey(x));
    for (const x of [...DISCLOSURE_STATUSES, 'other']) three(statusKey(x));
    for (const x of [...DISCLOSURE_ACTS, 'other']) three(actKey(x));
    for (const x of DISCLOSURE_ACTS) { three(`esg.act.rule.${x}`); three(`esg.act.done.${x}`); }
    for (const x of [...WITHDRAW_REASONS, 'other']) three(reasonKey(x));
    for (const x of [...DISCLOSURE_REFUSALS, ...ACT_REFUSALS, ...TRANSPORT_CODES]) three(refusalKey(x));
    three(refusalKey('NOT_A_CODE'));
    for (const st of ['flaggedOff', 'restricted', 'notFound', 'error', 'noData', 'readOnly']) { three(`esg.state.${st}.title`); three(`esg.state.${st}.body`); }
    for (const x of ['latest_source_fact', 'catalogue_now']) three(`esg.methodPage.rule.${x}`);
    for (const x of ['omov.main', 'omov.max', 'omov.overRoll', 'omov.notRecorded', 'adulteration.main', 'adulteration.retests', 'adulteration.last', 'adulteration.none',
      'audit.appendOnly', 'audit.notAppendOnly', 'audit.noHash', 'audit.hashColumns', 'audit.ledgerChained', 'audit.ledgerNotChained']) three(`esg.fact.${x}`);
    for (const x of ['esg.export.restricted', 'esg.form.field.metricCode', 'esg.form.field.text', 'esg.freshness.asOf', 'esg.freshness.now', 'esg.report.in', 'esg.report.out',
      'esg.form.title', 'esg.form.editTitle', 'esg.form.submit', 'esg.form.saveEdit', 'esg.act.title']) three(x);
  });
  it('every esg.* key has the same {vars} in all three languages, and none is blank', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('esg.'));
    expect(keys.length).toBeGreaterThan(180);
    for (const k of keys) {
      const e = String(en[k as keyof typeof en]); const h = String(hi[k as keyof typeof hi] ?? ''); const g = String(gu[k as keyof typeof gu] ?? '');
      expect([k, vars(h), vars(g)]).toEqual([k, vars(e), vars(e)]);
      expect([k, e.trim().length > 0 && h.trim().length > 0 && g.trim().length > 0]).toEqual([k, true]);
    }
  });
});
