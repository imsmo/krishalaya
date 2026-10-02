// modules/esg/__tests__/tenant9d-esg.spec.ts · PC-56 TENANT-9d · ESG's pure rules, and the places the code and 0183 must agree.
//   • THE GATE — a figure only where a PUBLISHED, citable method meets a PRESENT fact; every other verdict carries none;
//   • freshness in the cooperative's own days (stale strictly after the method's bound);
//   • the disclosure review — words in active languages, 20–2,000 code points, no markup, NO NUMBER in any script;
//   • the act verdicts and the state machine; the export's rows and receipt notes (unsigned first, every refusal by name);
//   • the registry in the migration = the code's list; the seed carries every word; the grants keep the registry read-only;
//   • the repository's SQL binds every disclosure alias to the tenant; the facts never read the carbon or grievance tables.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ESG_REFUSED_BY_NAME, FACT_KINDS, Fact, MAX_NOTE, MAX_TEXT, METRIC_CODES, MIN_NOTE, MIN_TEXT, MethodRow, PILLARS,
  addDays, buildDisclosureReview, daysBetween, disclosureActVerdict, factPresent, freshnessOf, hasNumber, isCivilDay, printable,
  retryIsMutation, verdictOf, windowEnding,
} from '../domain/esg-rules';
import { DISCLOSURE_TRANSITIONS, actsFor, canTransition, isDisclosureAct } from '../domain/esg-disclosure.state';
import { ESG_EXPORT_HEADER, ESG_UNSIGNED_NOTE, EsgEntry, exportNotes, exportRows, figuresOf } from '../domain/esg-export';
import { REPORT_REFUSED_BY_NAME } from '../services/esg.service';

const ROOT = path.join(__dirname, '../../../../../..');
const mig = () => fs.readFileSync(path.join(ROOT, 'db/migrations/0183_esg.sql'), 'utf8');
const seed = (f: string) => fs.readFileSync(path.join(ROOT, 'db/seeds/core', f), 'utf8');
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const method = (over: Partial<MethodRow> = {}): MethodRow => ({
  metricCode: 'adulteration', pillar: 'S', sortOrder: 4, methodStatus: 'published', refusalKind: null, methodRef: 'KV-ESG-S4', methodVersion: 1,
  publishedAt: '2026-10-02T00:00:00.000Z', factKind: 'adulteration', sourceTables: ['milk_collections'], freshnessRule: 'latest_source_fact',
  staleAfterDays: 2, windowDays: 30, ...over,
});
const adult = (over: Partial<Extract<Fact, { kind: 'adulteration' }>> = {}): Fact => ({
  kind: 'adulteration', windowDays: 30, from: '2026-09-03', to: '2026-10-02', pours: 40, flaggedPours: 2, waterFlagged: 1,
  reviewsOpened: 2, retested: 1, lastFlaggedDay: '2026-09-20', asOf: '2026-10-02T06:15', ...over,
} as Fact);
const omov = (over: Partial<Extract<Fact, { kind: 'omov' }>> = {}): Fact => ({
  kind: 'omov', closedWithSnapshot: 2, ballots: 7, eligibleAtClose: 10, maxBallotsPerMember: 1, overRoll: 0, notRecordedCloses: 0, asOf: '2026-09-30T18:00', ...over,
} as Fact);
const audit: Fact = { kind: 'audit_trail', appendOnly: true, canInsert: true, canUpdate: false, canDelete: false, canTruncate: false, hashColumns: [], ledgerChained: true, asOf: '2026-10-02T09:00' };

describe('0183 · the registry in the migration is the code\'s', () => {
  const rows = () => [...mig().matchAll(/^\s+\('([a-z_]+)',\s+'([ESG])', (\d+), '(published|not_published)',\s+(NULL|'[a-z_]+'),\s*(NULL|'[A-Z0-9-]+'),\s*(NULL|\d+),[^,]*,\s*'([a-z_]+)'/gm)]
    .map((m) => ({ code: m[1], pillar: m[2], order: Number(m[3]), status: m[4], refusal: m[5], ref: m[6], factKind: m[8] }));
  it('fourteen rows, the canon\'s order and pillars (W423 draws 14; W424 says 13 — the registry carries what is drawn)', () => {
    const r = rows();
    expect(r.map((x) => x.code)).toEqual([...METRIC_CODES]);
    expect(r.map((x) => x.pillar).join('')).toBe('EEEESSSSSSGGGG');
    for (const p of PILLARS) expect(r.filter((x) => x.pillar === p).map((x) => x.order)).toEqual(r.filter((x) => x.pillar === p).map((_, i) => i + 1));
  });
  it('exactly three published methods — each with a reference and a fact kind the API has a reader for', () => {
    const pub = rows().filter((x) => x.status === 'published');
    expect(pub.map((x) => x.code).sort()).toEqual(['adulteration', 'audit_trail', 'one_member_one_vote']);
    for (const p of pub) { expect(p.ref).toMatch(/^'KV-ESG-/); expect(FACT_KINDS).toContain(p.factKind as never); }
    for (const x of rows().filter((y) => y.status === 'not_published')) { expect(x.ref).toBe('NULL'); expect(x.factKind).toBe('none'); }
    expect(rows().find((x) => x.code === 'carbon_participation')!.refusal).toBe("'no_programme'");
    expect(rows().find((x) => x.code === 'grievance_channels')!.status).toBe('not_published');   // no writer exists for labour_grievances
    expect(rows().find((x) => x.code === 'women_participation')!.status).toBe('not_published');  // no declared basis
  });
  it('a published row must cite itself completely — a CHECK, not app care', () => {
    expect(mig()).toMatch(/CONSTRAINT ck_esgm_published_cites CHECK \(\s*\(method_status = 'published'\s+AND method_ref IS NOT NULL AND method_version IS NOT NULL AND published_at IS NOT NULL\s+AND cardinality\(source_tables\) > 0 AND fact_kind <> 'none'/);
  });
  it('the registry is READ-ONLY for the tenant realm; the disclosures have no DELETE; the carbon tables are not touched', () => {
    const m = mig();
    expect(m).toContain('REVOKE ALL ON esg_metric_methods FROM kv_app, kv_relay;');
    expect(m).toContain('GRANT SELECT ON esg_metric_methods TO kv_app, kv_relay, kv_readonly;');
    expect(m).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON esg_metric_methods/);
    expect(m).not.toMatch(/GRANT[^;]*DELETE[^;]*ON esg_disclosures/);
    const code = m.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/carbon_(projects|enrolments|credits)/);
  });
  it('the number net covers the launch scripts\' digits (ASCII, Devanagari, Gujarati) and is the CHECK on every disclosure', () => {
    const fn = /e\.value ~ '\[([^\]]+)\]'/.exec(mig())![1];
    for (const r of ['0-9', '०-९', '૦-૯', '٠-٩', '０-９']) expect(fn).toContain(r);
    expect(mig()).toContain('CONSTRAINT ck_esgd_no_number CHECK (NOT esg_text_has_number(texts))');
  });
  it('the verbs are rows in the migration AND the seed; the auditor\'s five reads are untouched', () => {
    for (const s of [mig(), seed('0004_roles_permissions.sql')]) { expect(s).toContain("'esg.read'"); expect(s).toContain("'esg.disclose'"); }
    expect(mig()).toMatch(/r\.code IN \('tenant_admin', 'fpo_coordinator'\) AND p\.code = 'esg\.read'/);
    expect(mig()).toMatch(/r\.code = 'tenant_admin' AND p\.code = 'esg\.disclose'/);
    expect(mig()).not.toMatch(/'auditor'[^;]*esg/);
    expect(seed('0004_roles_permissions.sql')).toContain("OR (r.code='auditor'       AND p.code IN ('ledger.read','report.view','audit.read','kyc.read','governance.read'))");
  });
  it('the flag is born OFF', () => { expect(mig()).toMatch(/SELECT 'esg',[\s\S]*?false, 100, '\{\}'/); });
  it('the withdraw reasons in 0183 are the ones the console offers', () => {
    expect([...mig().matchAll(/\('esg_disclosure_withdraw_reason', '([a-z_]+)'/g)].map((m) => m[1])).toEqual(['superseded', 'inaccurate', 'drafting_error', 'board_decision']);
  });
});

describe('seed 0021 · every word of the registry, ×3', () => {
  const s = () => seed('0021_ui_messages_esg.sql');
  const has = (k: string) => { for (const l of ['en', 'hi', 'gu']) expect([k, l, s().includes(`('${k}', '${l}', '`)]).toEqual([k, l, true]); };
  it('a name for all fourteen; a "needs" for every unpublished row; the method for each published one', () => {
    for (const c of METRIC_CODES) has(`esg.metric.${c}.name`);
    for (const c of METRIC_CODES.filter((x) => !['adulteration', 'one_member_one_vote', 'audit_trail'].includes(x))) has(`esg.metric.${c}.needs`);
    for (const c of ['adulteration', 'one_member_one_vote', 'audit_trail']) has(`esg.method.${c}.text`);
    for (const l of ['en', 'hi', 'gu']) expect(seed('0017_ui_messages_export_datasets.sql')).toContain(`('exports.dataset.esg.metrics', '${l}', `);
    expect(fs.readFileSync(path.join(ROOT, 'db/scripts/seed.js'), 'utf8')).toContain("'core/0021_ui_messages_esg.sql'");
  });
});

describe('THE GATE · a figure only where a published method meets a recorded fact', () => {
  it('no method → no figure, EVEN WHEN A FACT EXISTS', () => {
    const m = method({ methodStatus: 'not_published', refusalKind: 'no_method', methodRef: null, methodVersion: null, factKind: 'none' });
    expect(verdictOf(m, adult())).toBe('no_method');
    expect(printable(m, adult())).toBeNull();
    expect(freshnessOf(m, adult(), { zone: 'Asia/Kolkata', today: '2026-10-02' })).toBeNull();
  });
  it('carbon → "no programme", never a count', () => {
    const m = method({ metricCode: 'carbon_participation', methodStatus: 'not_published', refusalKind: 'no_programme', factKind: 'none' });
    expect(verdictOf(m, null)).toBe('no_programme');
    expect(verdictOf(m, adult())).toBe('no_programme');
    expect(printable(m, omov())).toBeNull();
  });
  it('published, nothing recorded → published_no_fact (never 0)', () => {
    expect(verdictOf(method(), null)).toBe('published_no_fact');
    expect(verdictOf(method(), adult({ pours: 0, flaggedPours: 0 }))).toBe('published_no_fact');
    expect(printable(method(), adult({ pours: 0 }))).toBeNull();
    expect(verdictOf(method({ metricCode: 'one_member_one_vote', factKind: 'omov' }), omov({ closedWithSnapshot: 0 }))).toBe('published_no_fact');
  });
  it('published + present → the figure; a fact of ANOTHER kind is no fact', () => {
    expect(verdictOf(method(), adult())).toBe('published_with_fact');
    expect(printable(method(), adult())).toEqual(adult());
    expect(verdictOf(method(), omov())).toBe('published_no_fact');
    expect(verdictOf(method({ factKind: 'audit_trail' }), audit)).toBe('published_with_fact');
  });
  it('published but its text cannot be cited → no method (nothing to cite)', () => {
    expect(verdictOf(method(), adult(), false)).toBe('no_method');
    expect(printable(method(), adult(), false)).toBeNull();
  });
  it('factPresent per kind', () => {
    expect([factPresent(adult({ pours: 1 })), factPresent(adult({ pours: 0 })), factPresent(omov({ closedWithSnapshot: 1 })), factPresent(omov({ closedWithSnapshot: 0 })), factPresent(audit)])
      .toEqual([true, false, true, false, true]);
  });
});

describe('freshness · the cooperative\'s own days', () => {
  const clock = { zone: 'Asia/Kolkata', today: '2026-10-02' };
  it('stale strictly AFTER the method\'s bound; the date is kept either way', () => {
    expect(freshnessOf(method(), adult({ asOf: '2026-09-30T10:00' }), clock)).toMatchObject({ ageDays: 2, stale: false, asOfDay: '2026-09-30' });
    expect(freshnessOf(method(), adult({ asOf: '2026-09-29T23:59' }), clock)).toMatchObject({ ageDays: 3, stale: true, asOfDay: '2026-09-29', zone: 'Asia/Kolkata' });
    expect(freshnessOf(method({ staleAfterDays: null }), adult({ asOf: '2020-01-01T00:00' }), clock)).toMatchObject({ stale: false });
    expect(freshnessOf(method(), adult({ asOf: null }), clock)).toMatchObject({ asOfDay: null, ageDays: null, stale: false });
    expect(freshnessOf(method(), adult({ asOf: '2026-10-03T01:00' }), clock)).toMatchObject({ ageDays: 0 });
  });
  it('calendar arithmetic', () => {
    expect(windowEnding('2026-10-02', 30)).toEqual({ from: '2026-09-03', to: '2026-10-02' });
    expect(windowEnding('2026-03-01', 1)).toEqual({ from: '2026-03-01', to: '2026-03-01' });
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2);
    expect([isCivilDay('2026-02-30'), isCivilDay('2026-02-28'), isCivilDay('26-1-1')]).toEqual([false, true, false]);
  });
});

describe('the disclosure review · words, never a number', () => {
  const ctx = (over: Partial<Parameters<typeof buildDisclosureReview>[1]> = {}) => ({ canDisclose: true, metricCodes: [...METRIC_CODES], languages: ['en', 'hi', 'gu'], current: null, ...over });
  const words = 'The cooperative tests every pour at the counter in front of the member.';
  const codes = (r: ReturnType<typeof buildDisclosureReview>) => r.refusals.map((x) => x.code);
  it('a clean draft is ready and stores the normalised words', () => {
    const r = buildDisclosureReview({ metricCode: 'adulteration', texts: { en: `  ${words}  `, gu: '' } }, ctx());
    expect(r.ready).toBe(true); expect(r.texts).toEqual({ en: words }); expect(r.metricCode).toBe('adulteration');
    expect(r.fields.find((f) => f.name === 'text.en')).toMatchObject({ stored: words, normalised: true });
    expect(r.diff).toBeNull();
  });
  it('NUMBER_IN_DISCLOSURE in any script — ASCII, Devanagari, Gujarati, Arabic-Indic, full-width', () => {
    for (const d of ['0', '7', '२', '૫', '٣', '７', '୫', '৪']) {
      const r = buildDisclosureReview({ metricCode: 'adulteration', texts: { en: `${words} about ${d} pours` } }, ctx());
      expect([d, codes(r)]).toEqual([d, ['NUMBER_IN_DISCLOSURE']]);
    }
    expect(hasNumber('eighteen percent of members')).toBe(false);
    expect(hasNumber('%')).toBe(false);
  });
  it('length bounds in code points (20 / 2,000), markup, unknown language, nothing written', () => {
    const ok = 'अ'.repeat(MIN_TEXT); const short = 'अ'.repeat(MIN_TEXT - 1);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: { hi: ok } }, ctx()))).toEqual([]);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: { hi: short } }, ctx()))).toEqual(['TEXT_TOO_SHORT']);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: { en: 'a'.repeat(MAX_TEXT) } }, ctx()))).toEqual([]);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: { en: 'a'.repeat(MAX_TEXT + 1) } }, ctx()))).toEqual(['TEXT_TOO_LONG']);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: { en: `${words}<script>` } }, ctx()))).toEqual(['TEXT_HAS_MARKUP']);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: { mr: words } }, ctx()))).toEqual(['LANGUAGE_UNKNOWN']);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: { en: '  ' } }, ctx()))).toEqual(['TEXT_REQUIRED']);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: {} }, ctx()))).toEqual(['TEXT_REQUIRED']);
  });
  it('the metric: required, known, fixed on an edit; permission; a non-draft; nothing changed; the diff', () => {
    expect(codes(buildDisclosureReview({ texts: { en: words } }, ctx()))).toEqual(['METRIC_REQUIRED']);
    expect(codes(buildDisclosureReview({ metricCode: 'happiness', texts: { en: words } }, ctx()))).toEqual(['METRIC_UNKNOWN']);
    expect(codes(buildDisclosureReview({ metricCode: 'adulteration', texts: { en: words } }, ctx({ canDisclose: false })))).toEqual(['NO_PERMISSION']);
    const cur = { status: 'draft', metricCode: 'adulteration', texts: { en: words } };
    expect(codes(buildDisclosureReview({ metricCode: 'audit_trail', texts: { en: words } }, ctx({ current: cur })))).toEqual(['METRIC_FIXED']);
    expect(codes(buildDisclosureReview({ texts: { en: words } }, ctx({ current: cur })))).toEqual(['NOTHING_CHANGED']);
    expect(codes(buildDisclosureReview({ texts: { en: `${words} Again.` } }, ctx({ current: { ...cur, status: 'published' } })))).toEqual(['NOT_A_DRAFT']);
    const e = buildDisclosureReview({ texts: { en: words, gu: 'સહકારી દરેક ઠાલવણ સભ્યની સામે તપાસે છે.' } }, ctx({ current: cur }));
    expect(e.ready).toBe(true);
    expect(e.diff).toEqual([{ field: 'text.gu', before: null, after: 'સહકારી દરેક ઠાલવણ સભ્યની સામે તપાસે છે.' }]);
  });
});

describe('the acts · publish · withdraw', () => {
  const ctx = (over = {}) => ({ canDisclose: true, otherPublished: false, reasons: ['superseded', 'inaccurate', 'drafting_error', 'board_decision'], ...over });
  const v = (act: 'publish' | 'withdraw', status: string, input: { reasonCode?: string; note?: string }, over = {}) => disclosureActVerdict(act, { status }, ctx(over), input);
  it('publish: a draft, nobody else published on the metric, a note', () => {
    expect(v('publish', 'draft', { note: 'as approved by the board' })).toEqual({ allowed: true, refusals: [], to: 'published' });
    expect(v('publish', 'published', { note: 'again' }).refusals).toEqual(['NOT_A_DRAFT']);
    expect(v('publish', 'withdrawn', { note: 'again' }).refusals).toEqual(['ALREADY_FINAL']);
    expect(v('publish', 'draft', { note: 'board' }, { otherPublished: true }).refusals).toEqual(['ANOTHER_PUBLISHED']);
    expect(v('publish', 'draft', { note: 'board' }, { canDisclose: false }).refusals).toEqual(['NO_PERMISSION']);
  });
  it('withdraw: draft or published, a declared reason, a note of 3–300', () => {
    expect(v('withdraw', 'published', { reasonCode: 'inaccurate', note: 'figures moved' }).allowed).toBe(true);
    expect(v('withdraw', 'draft', { reasonCode: 'drafting_error', note: 'nah' }).allowed).toBe(true);
    expect(v('withdraw', 'withdrawn', { reasonCode: 'inaccurate', note: 'x'.repeat(3) }).refusals).toEqual(['ALREADY_FINAL']);
    expect(v('withdraw', 'published', { note: 'abc' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(v('withdraw', 'published', { reasonCode: 'whim', note: 'abc' }).refusals).toEqual(['REASON_UNKNOWN']);
    expect(v('withdraw', 'published', { reasonCode: 'inaccurate', note: 'ab' }).refusals).toEqual(['NOTE_REQUIRED']);
    expect(v('withdraw', 'published', { reasonCode: 'inaccurate', note: 'x'.repeat(MAX_NOTE) }).allowed).toBe(true);
    expect(v('withdraw', 'published', { reasonCode: 'inaccurate', note: 'x'.repeat(MAX_NOTE + 1) }).refusals).toEqual(['NOTE_TOO_LONG']);
    expect(MIN_NOTE).toBe(3);
  });
  it('the state machine — and 0183\'s guard says the same moves', () => {
    expect(DISCLOSURE_TRANSITIONS).toEqual({ publish: { from: ['draft'], to: 'published' }, withdraw: { from: ['draft', 'published'], to: 'withdrawn' } });
    expect([actsFor('draft'), actsFor('published'), actsFor('withdrawn')]).toEqual([['publish', 'withdraw'], ['withdraw'], []]);
    expect([canTransition('publish', 'published'), isDisclosureAct('retry'), retryIsMutation()]).toEqual([false, false, false]);
    expect(mig()).toContain("RAISE EXCEPTION 'esg_disclosures: a withdrawn disclosure is final'");
    expect(mig()).toContain("IF NEW.status <> 'withdrawn' OR NEW.texts IS DISTINCT FROM OLD.texts");
    expect(mig()).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_esgd_one_published ON esg_disclosures (tenant_id, metric_code) WHERE status = \'published\'');
  });
});

describe('W424 · the export carries only what the gate passed, and names the rest', () => {
  const entry = (m: MethodRow, raw: Fact | null): EsgEntry => ({ method: m, verdict: verdictOf(m, raw), fact: printable(m, raw),
    freshness: freshnessOf(m, raw, { zone: 'Asia/Kolkata', today: '2026-10-02' }), name: { en: m.metricCode, gu: `gu:${m.metricCode}` }, methodText: { en: 'how', gu: 'કેમ' } });
  const entries = [
    entry(method(), adult()),
    entry(method({ metricCode: 'one_member_one_vote', pillar: 'G', factKind: 'omov', methodRef: 'KV-ESG-G1' }), omov({ closedWithSnapshot: 0 })),
    entry(method({ metricCode: 'water_per_kg', pillar: 'E', methodStatus: 'not_published', refusalKind: 'no_method', methodRef: null, methodVersion: null, factKind: 'none' }), adult()),
    entry(method({ metricCode: 'carbon_participation', pillar: 'E', methodStatus: 'not_published', refusalKind: 'no_programme', methodRef: null, methodVersion: null, factKind: 'none' }), null),
  ];
  it('rows: one per figure of the printable fact, its method beside it; a disclosure as words', () => {
    const rows = exportRows(entries, [{ metricCode: 'water_per_kg', texts: { en: 'drip lines on most plots', gu: 'ટપક' }, publishedAt: '2026-10-01T00:00:00.000Z' }], 'gu');
    const figures = rows.filter((r) => r[3] === 'figure');
    expect(new Set(figures.map((r) => r[1]))).toEqual(new Set(['adulteration']));
    expect(figures.length).toBe(figuresOf(adult()).length);
    expect(figures[0].slice(0, 7)).toEqual(['S', 'adulteration', 'gu:adulteration', 'figure', 'KV-ESG-S4', 1, 'કેમ']);
    expect(figures.find((r) => r[7] === 'pours_flagged')![8]).toBe(2);
    const d = rows.filter((r) => r[3] === 'disclosure');
    expect(d).toEqual([['E', 'water_per_kg', 'gu:water_per_kg', 'disclosure', null, null, null, null, null, null, null, null, 'ટપક', '2026-10-01T00:00:00.000Z']]);
    for (const r of rows) expect(r.length).toBe(ESG_EXPORT_HEADER.length);
  });
  it('notes: UNSIGNED first; every left-out metric by name with why; what the file does not claim', () => {
    const n = exportNotes(entries, { zone: 'Asia/Kolkata', today: '2026-10-02', lang: 'gu', langFallback: false, disclosures: 1 });
    expect(n[0]).toBe(ESG_UNSIGNED_NOTE);
    expect(n).toContain('excluded: one_member_one_vote — method KV-ESG-G1 v1 published, nothing recorded for it yet — no figure, never a zero');
    expect(n).toContain('excluded: water_per_kg — no method published — no method, no metric');
    expect(n).toContain('excluded: carbon_participation — no programme recorded on this platform (the platform does not issue or sell credits)');
    expect(n.find((x) => x.startsWith('included:'))).toContain('adulteration');
    expect(n.join(' ')).toMatch(/not claimed byte-identical/);
    expect(n.join(' ')).toMatch(/no audience-specific shape, no document id, no verify URL, no watermark, no PDF/);
  });
  it('the file cannot widen the gate: a mis-built entry (a fact beside a non-printable verdict) yields no figure row', () => {
    const bad: EsgEntry = { ...entries[2], fact: adult() };                       // water_per_kg: no_method, yet a fact attached
    expect(exportRows([bad], [], 'en')).toEqual([]);
    const n = exportNotes(entries, { zone: 'UTC', today: '2026-10-02', lang: 'en', langFallback: true, disclosures: 0 });
    expect(n.filter((x) => x.startsWith('excluded: ')).map((x) => x.slice(10).split(' — ')[0])).toEqual(['one_member_one_vote', 'water_per_kg', 'carbon_participation']);
    expect(n).toContain('requested language not active; names and methods in en');
  });
  it('W424\'s refusals are in the API\'s list', () => {
    for (const r of REPORT_REFUSED_BY_NAME) expect(ESG_REFUSED_BY_NAME).toContain(r);
  });
});

describe('the SQL keeps its promises', () => {
  it('every esg_disclosures alias is bound to the tenant in its own SQL (Law 1 — RLS is the net, not the plan)', () => {
    const repo = src('repositories/esg.repository.ts');
    const stmts = [...repo.matchAll(/`([^`]*esg_disclosures d[^`]*)`/g)].map((m) => m[1]);
    expect(stmts.length).toBeGreaterThanOrEqual(7);
    for (const s of stmts) if (!/^\s*INSERT/.test(s)) expect([s.slice(0, 60), /d\.tenant_id = \$1/.test(s)]).toEqual([s.slice(0, 60), true]);
  });
  it('the facts read the snapshot (never today\'s roll), prune pours by day, and never read the carbon or grievance tables', () => {
    const f = src('read-models/esg-facts.read-model.ts').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(f).toContain('eligible_at_close');
    expect(f).not.toMatch(/user_tenant_roles|coop_share_registers/);
    expect(f).toMatch(/c\.collected_on BETWEEN \$2::date AND \$3::date/);
    expect(f).not.toMatch(/carbon_|labour_grievances/);
    for (const q of [...f.matchAll(/FROM (coop_resolutions|coop_votes|milk_collections|milk_quality_reviews) (\w+)/g)]) {
      expect([q[1], new RegExp(`${q[2]}\\.tenant_id = \\$1`).test(f)]).toEqual([q[1], true]);
    }
  });
  it('the controller is behind the flag and the read permission; the service reads a fact ONLY behind a published, citable method', () => {
    const c = src('controllers/v1/esg.controller.ts');
    expect(c).toContain("@FeatureFlag('esg')");
    expect(c).toContain("@RequirePermissions('esg.read')");
    const s = src('services/esg.service.ts');
    expect(s).toContain("m.methodStatus === 'published' && cited && isFactKind(m.factKind) ? await this.readFact(tenantId, m, clock) : null");
    expect(s).toContain('fact: printable(m, raw, cited)');
    expect(MIN_TEXT).toBe(20);
  });
});
