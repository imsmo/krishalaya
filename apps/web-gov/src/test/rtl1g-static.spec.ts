import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-gov/src/test/rtl1g-static.spec.ts · PC-56 RTL-1g — the static half of the gov leftovers (the render half is
// test-render/rtl1g-gov.render.test.tsx): the pages hand their language to the views that now isolate, and each owed site uses the isolate.
const SRC = join(__dirname, '..');
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');

describe('the pages pass the page language', () => {
  const PAGES: Array<[string, string[]]> = [
    ['app/applications/[id]/page.tsx', ['<ActForm t={t} lang={getLang()} appId=', '<ApplicationDetailView t={t} lang={getLang()} state=']],
    ['app/schemes/[id]/page.tsx', ['<SchemeDetailView t={t} lang={getLang()} state=']],
    ['app/access/page.tsx', ['<AccessDoneNote t={t} lang={getLang()} done=', '<ApproveConfirm t={t} lang={getLang()} row=', '<RemoveForm t={t} lang={getLang()} row=']],
  ];
  it.each(PAGES)('%s', (f, needles) => { for (const n of needles) expect({ n, has: read(f).includes(n) }).toEqual({ n, has: true }); });
});

describe('each owed site isolates (ltrText / ltrOrNull)', () => {
  const SITES: Array<[string, string]> = [
    ['components/gov2/ApplicationsViews.tsx', '<Fact t={t} k="gov2.app.submitted" id="submitted">{dash(t, ltrOrNull(atUtc(a.submittedAt), lang))}</Fact>'],
    ['components/gov2/ApplicationsViews.tsx', '<Fact t={t} k="gov2.app.decided" id="decided">{dash(t, ltrOrNull(atUtc(a.decidedAt), lang))}</Fact>'],
    ['components/gov2/ApplicationsViews.tsx', '{`${a.scheme.name} (${ltrText(a.scheme.code, lang)})`}</a></Fact>'],
    ['components/gov2/ApplicationsViews.tsx', "t.t('gov2.form.application', { id: ltrText(shortId(appId), lang) })"],
    ['components/gov2/SchemesViews.tsx', '<Fact t={t} k="gov2.id.publishedAt" id="published-at">{shown(t, ltrOrNull(atUtc(s.publishedAt), lang))}</Fact>'],
    ['components/gov2/SchemesViews.tsx', '<td>{shown(t, ltrOrNull(atUtc(v.publishedAt), lang))}</td>'],
    ['components/gov2/SchemesViews.tsx', "t.t('gov2.rule.notApplied', { keys: ltrText(w.notApplied.join(', '), lang) })"],
    ['components/gov2/SchemesViews.tsx', '<RulesInWords t={t} rules={s.published.rules} lang={lang} />'],
    ['components/gov2/SchemesViews.tsx', '<RulesInWords t={t} rules={v as Record<string, unknown>} lang={lang} />'],
    ['components/gov1/AccessViews.tsx', '<dd>{endsText(t, m, lang)}</dd>'],
    ['components/gov1/AccessViews.tsx', "t.t('gov1.access.done.approved', { at: ltrOrNull(atUtc(expiresAt), lang) ?? t.t('common.dash') })"],
    ['components/gov1/AccessViews.tsx', "t.t('gov1.access.youRow', { name: ltrText(personLabel(m), lang) })"],
  ];
  it.each(SITES)('%s: %s', (f, needle) => { expect(read(f)).toContain(needle); });
  it('both confirm forms hand lang to RowFacts', () => {
    expect(read('components/gov1/AccessViews.tsx').match(/<RowFacts t=\{t\} m=\{row\} rows=\{rows\} me=\{me\} lang=\{lang\} \/>/g)).toHaveLength(2);
  });
});
