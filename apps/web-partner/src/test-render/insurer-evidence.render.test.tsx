// apps/web-partner/src/test-render/insurer-evidence.render.test.tsx · PC-56 PARTNER-3b · W255 EVIDENCE REVIEW — AN HONEST PAGE (founder Q4 + Q5 +
// the 3b door): the statement VERBATIM; the three COUNTS OF CLAIMS by survey status with the FY label and an as-of (M3's neighbour); NO count of
// media items of any kind — no digit beside a photo / video / image / document / media word, no file extension, no URL (M2 kills here); "Take
// next" and "Retry" DECOR → the W2866 chain; "View claims" real; the empty / error / OFF / kind states; the six-row sub-navigation (M1 kills).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerEvidenceView } from '../components/partner3/InsurerEvidenceView';
import { insurerFailureOf, wrongConsole } from '../features/partner2/figures';
import { stageCountsState } from '../features/partner3/figures';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';
import { COUNTS_3B, COUNTS_NO_STAGE, FALSE_3B, MEDIA_FILES, mediaCount } from './partner3b-fixtures';

const render = (state: Parameters<typeof InsurerEvidenceView>[0]['state'], cat: Record<string, string> = en, counts = COUNTS_3B) =>
  renderToStaticMarkup(<InsurerEvidenceView t={tr(cat)} lang="en" state={state} counts={counts} />);

describe('PC-56 PARTNER-3b · W255 the evidence page (render)', () => {
  const html = render(stageCountsState(COUNTS_3B, null)); const w = text(html);
  it('the founder\'s evidence statement, verbatim and pinned to its key — the page says what the platform does, never what an insurer may do', () => {
    expect(html).toContain('data-kv-insurer="evidence"'); expect(html).toContain('data-kv-state="ok"');
    expect(html).toContain('data-kv-statement="partner3.evidence.statement"');
    expect(w).toContain('Claim evidence — photos, videos and documents — stays with the farmer and the organisation that serves them. Insurers do not see, review, verify or request evidence on the platform.');
    expect(w).toContain(en['partner3.evidence.statement']);
  });
  it('the three COUNTS OF CLAIMS by survey status — awaiting = intimated + documents pending — with the FY label and an as-of', () => {
    expect(html).toContain('data-kv-counts="evidence"');
    const n = (id: string) => new RegExp(`data-kv-count="${id}"><dt>[^<]+</dt><dd>(\\d+)</dd>`).exec(html)?.[1];
    expect(['awaiting', 'scheduled', 'surveyed'].map(n)).toEqual(['5', '1', '4']);   // 2 intimated + 3 docs_pending · 1 · 4
    expect(w).toContain('Awaiting a survey'); expect(w).toContain('Survey scheduled'); expect(w).toContain('Surveyed');
    expect(w).toContain('Financial year 2026-27 (April to March, India time)');
    expect(html).toContain('data-kv-asof="2026-10-20T06:30:00.000Z"');
    expect(w).toContain('counts of CLAIMS');
  });
  it('NO count of media items anywhere: no digit beside a photo / video / image / document / media word, no file, no URL, no media field (M2)', () => {
    expect(mediaCount(w)).toEqual([]);
    expect(html).not.toMatch(MEDIA_FILES);
    expect(html).not.toMatch(/mediaUrl|media_url|photoCount|videoCount|evidenceCount|signedUrl|data-kv-media/);
    expect(percents(w)).toBe(0);
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(text(withoutRefusals(html))).not.toMatch(FALSE_3B);
    for (const k of partner3RefusalKeys('evidence')) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('"Take next" and "Retry" are DECOR → the W2866 chain; "View claims" and "View surveys" are real; no <form>, no act', () => {
    expect(html).toContain('href="/insurer/claims/evidence?act=confirm"'); expect(html).toContain('data-kv-decor="take-next"');
    expect(html).toContain('href="/insurer/claims"'); expect(html).toContain('data-kv-real="claims"');
    expect(html).toContain('href="/insurer/surveys"'); expect(html).toContain('data-kv-real="surveys"');
    expect(html).not.toContain('<form'); expect(html).not.toContain('<button');
  });
  it('the sub-navigation: six live rows, Evidence current (M1 kills here)', () => {
    expect(html).toContain('data-kv-subnav="claims"');
    expect([...html.matchAll(/data-kv-subnav-item="/g)].length).toBe(6);
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/insurer\/claims\/evidence"/);
  });
  it('empty: no claim on your products is awaiting a survey (though claims were filed in the window); error: nothing is broken + the re-read', () => {
    const e = render(stageCountsState(COUNTS_NO_STAGE, null), en, COUNTS_NO_STAGE);
    expect(e).toContain('data-kv-state="empty"');
    expect(text(e)).toContain('No claim on your products is awaiting a survey');
    expect(e).not.toContain('data-kv-counts="evidence"');
    const x = render(stageCountsState(null, insurerFailureOf(500, 'INTERNAL', 'on')), en, COUNTS_3B);
    expect(x).toContain('data-kv-state="error"'); expect(text(x)).toContain('Nothing is broken on the platform\'s side');
    expect(x).toContain('data-kv-retry="true"'); expect(text(withoutRefusals(x))).not.toMatch(/unavailable|server-side/i);
  });
  it('switched off: the console and the platform\'s insurance — "nothing is broken" (en, hi, gu); a lender is sent away (the kind rule)', () => {
    const off = render(stageCountsState(null, insurerFailureOf(404, 'NOT_FOUND', 'off')));
    expect(off).toContain('data-kv-insurer="evidence"'); expect(off).toContain('data-kv-state="off"'); expect(text(off)).toContain('Nothing is broken');
    const ins = render(stageCountsState(null, insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown')));
    expect(ins).toContain('data-kv-state="insurance_off"'); expect(text(ins)).toContain(en['partner2.insuranceOff.title']);
    expect(text(withoutRefusals(off))).not.toMatch(/plan settings/i);
    for (const cat of [hi, gu]) expect(text(render('ok', cat))).toContain(cat['partner3.evidence.statement']);
    expect([wrongConsole('bank', 'insurer'), wrongConsole('amc', 'insurer'), wrongConsole('insurer', 'insurer')]).toEqual([true, true, false]);
  });
});
