// apps/web-partner/src/test-render/rtl-partner3b.render.test.tsx · PC-56 PARTNER-3b — the RTL spot-check of the six new layouts (the 2a / 2b / 3a
// precedent): rendered inside dir="rtl" in en, hi and gu, the evidence page, the evidence board, the surveyors page, the surveys page, the survey
// report and a 3b chain carry no inline style, no bare directional arrow (none is drawn, so no DirArrow is needed) and no physical left/right
// class. This wave adds no CSS: every class it uses was shipped by PARTNER-2a/2b/3a, so `globals.css` is untouched.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerEvidenceView } from '../components/partner3/InsurerEvidenceView';
import { InsurerEvidenceBoardView } from '../components/partner3/InsurerEvidenceBoardView';
import { InsurerSurveyorsView } from '../components/partner3/InsurerSurveyorsView';
import { InsurerSurveysView } from '../components/partner3/InsurerSurveysView';
import { InsurerSurveyReportView } from '../components/partner3/InsurerSurveyReportView';
import { InsurerFraudView } from '../components/partner3/InsurerFraudView';
import { InsurerClaimsChain } from '../components/partner3/InsurerClaimsChain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { tr } from './partner1a-fixtures';
import { CLAIM_SURVEYED, COUNTS_3B, STAGE_ROWS } from './partner3b-fixtures';

const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl">{node}</div>);

describe('PC-56 PARTNER-3b · RTL spot-check (en / hi / gu)', () => {
  const pages = ([['en', en], ['hi', hi], ['gu', gu]] as const).flatMap(([lang, cat]) => [
    rtl(<InsurerEvidenceView t={tr(cat)} lang={lang} state="ok" counts={COUNTS_3B} />),
    rtl(<InsurerEvidenceBoardView t={tr(cat)} lang={lang} c={CLAIM_SURVEYED} failure={null} />),
    rtl(<InsurerSurveyorsView t={tr(cat)} state="ok" />),
    rtl(<InsurerSurveysView t={tr(cat)} lang={lang} state="ok" items={STAGE_ROWS} counts={COUNTS_3B} stage="survey_scheduled" nextCursor="Y3Vyc29y" computedAt={COUNTS_3B.computedAt} />),
    rtl(<InsurerSurveyReportView t={tr(cat)} lang={lang} c={CLAIM_SURVEYED} failure={null} />),
    rtl(<InsurerFraudView t={tr(cat)} state="ok" />),
    rtl(<InsurerClaimsChain t={tr(cat)} chain="fraud_act" state="confirm" />),
  ]);
  it('no inline style, no bare arrow, no physical-side class in any new layout, in any of the three languages', () => {
    expect(pages.length).toBe(21);
    for (const html of pages) {
      expect(html).not.toMatch(/style="/);
      expect(html).not.toMatch(/[→←⇒⇐➜➔]/);
      expect(html).not.toMatch(/class="[^"]*(left|right)[^"]*"/);
    }
  });
  it('hi and gu render their own words (no English fallback for a new key)', () => {
    expect(pages[7]).toContain(hi['partner3.evidence.statement']); expect(pages[14]).toContain(gu['partner3.evidence.statement']);
    expect(pages[9]).toContain(hi['partner3.surveyors.statement']); expect(pages[16]).toContain(gu['partner3.surveyors.statement']);
    expect(pages[10]).toContain(hi['partner3.surveys.statement']); expect(pages[17]).toContain(gu['partner3.surveys.statement']);
    expect(pages[11]).toContain(hi['partner3.report.statement']); expect(pages[18]).toContain(gu['partner3.report.statement']);
    expect(pages[12]).toContain(hi['partner3.fraud.statement']); expect(pages[19]).toContain(gu['partner3.fraud.statement']);
    expect(pages[13]).toContain(hi['partner3.chain.act3b.confirm']); expect(pages[20]).toContain(gu['partner3.chain.act3b.confirm']);
    for (const html of pages.slice(7)) expect(html).not.toContain(en['partner3.evidence.statement']);
  });
  it('this wave adds no CSS: the PARTNER-3a block is still the last one, and it uses logical properties only', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    expect(css).not.toContain('PC-56 PARTNER-3b');
    const ours = css.slice(css.indexOf('PC-56 PARTNER-3a'));
    expect(ours.length).toBeGreaterThan(100);
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/);
  });
});
