// apps/web-ops/src/test-render/wh-insights.render.test.tsx · PC-56 OPS-2c · W379 /warehouse/insights — AN HONEST PAGE THAT READS NOTHING. The
// statement ×3; zero inputs; no figure (no digit at all in the visible text), no percentage; occupancy, intake, turnaround, pledge rate and re-assay
// counts refused by name; the assay page named in a sentence — NAMED UPDATE (PC-56 OPS-2b): W372 is built, so the sentence carries a REAL link to
// it (the OPS-2c rule "no link to an unbuilt route" stands: the assay page exists and the test proves it); export DECOR; a real link to billing.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsightsView } from '../components/ops2/InsightsView';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS2_REFUSALS } from '../features/ops2/refusals';
import { CONTROLS, percents, text, tr, visible } from './ops1a-fixtures';
import { FALSE_2C } from './ops2c-fixtures';

const html = renderToStaticMarkup(<InsightsView t={tr(en)} />);

describe('PC-56 OPS-2c · /warehouse/insights is honest and reads nothing', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the statement and the assay sentence verbatim', (_l, cat) => {
    const h = renderToStaticMarkup(<InsightsView t={tr(cat)} />);
    for (const k of ['ops2.insights.statement', 'ops2.insights.assaySentence']) expect([k, text(h).includes(cat[k])]).toEqual([k, true]);
  });
  it('says there are no insights yet, and why: nothing weighed, quantities not always in one unit', () => {
    expect(en['ops2.insights.statement']).toMatch(/^There are no warehouse insights here yet\. .*no quantity is weighed.*not always booked in one unit/);
  });
  it('zero inputs; no figure at all except the statement\'s words (no digit), no percentage, none of the canon\'s false words', () => {
    expect(CONTROLS.test(html)).toBe(false);
    expect(/\d/.test(visible(html))).toBe(false);
    expect(percents(text(html))).toBe(0);
    expect(FALSE_2C.test(visible(html))).toBe(false);
  });
  it('occupancy, intake, turnaround, pledge rate, re-assay counts, export and retry are refused by name', () => {
    for (const id of ['occupancy', 'intake_month', 'assay_turnaround', 'pledge_rate', 'reassay_due', 'overnight_compute', 'aggregate_view', 'insights_export', 'insights_retry'])
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    for (const r of OPS2_REFUSALS.filter((x) => x.surfaces.includes('wh_insights'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
  it('the only links: the assay page (built in OPS-2b), the billing page (built) and the export chain on THIS page', () => {
    const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1]);
    expect(hrefs).toEqual(['/warehouse/assay', '/warehouse/billing', '/warehouse/insights?export=queued']);
    for (const h of ['/warehouse/assay', '/warehouse/billing']) expect([h, fs.existsSync(path.join(__dirname, '..', 'app', h, 'page.tsx'))]).toEqual([h, true]);
  });
});
