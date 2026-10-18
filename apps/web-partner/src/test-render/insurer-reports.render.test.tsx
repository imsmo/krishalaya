// apps/web-partner/src/test-render/insurer-reports.render.test.tsx · PC-56 PARTNER-2b · W254 reports — AN HONEST PAGE: "Signed extracts for your
// filings are not available from the partner console yet"; "we never file for you" (true); "View policies" is a real link; "Generate Q1 pack" is
// DECOR (`/insurer/reports?form=` — F-18); every regulatory and payout claim refused by name; the state comes from the platform's flag map.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerReportsView } from '../components/partner2/InsurerReportsView';
import { switchesState } from '../features/partner2/figures';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2A } from './partner2a-fixtures';
import { FALSE_2B, MONEY } from './partner2b-fixtures';

const render = (state: Parameters<typeof InsurerReportsView>[0]['state'], cat: Record<string, string> = en) => renderToStaticMarkup(<InsurerReportsView t={tr(cat)} state={state} />);

describe('PC-56 PARTNER-2b · W254 reports — an honest page (render)', () => {
  const html = render(switchesState({ partner_console: true, insurance: true })); const w = text(html);
  it('the statement, "we never file for you", View policies (real), Generate pack (DECOR, no form)', () => {
    expect(html).toContain('data-kv-state="ok"');
    expect(w).toContain('Signed extracts for your filings are not available from the partner console yet');
    expect(w).toContain(en['partner2.reports.neverFile']);
    expect(html).toContain('href="/insurer/policies"'); expect(html).toContain('data-kv-real="policies"');
    expect(html).toContain('href="/insurer/reports?form=review"'); expect(html).not.toContain('<form');
  });
  it('every regulatory and payout claim refused by name; no figure, no canon word', () => {
    for (const k of partner2RefusalKeys('ins_reports')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const k of ['ruralQuota', 'claimsTime', 'complaints', 'extractsTable', 'replay', 'schedule', 'downloadMark', 'drillIns', 'reportPack']) expect(w).toContain(en[`partner2.refusal.${k}`]);
    expect(w).not.toMatch(MONEY); expect(w).not.toMatch(/\b\d+\s*%/);
    expect(w).not.toMatch(FALSE_2A); expect(w).not.toMatch(FALSE_2B);
  });
  it('states from the flag map: console OFF → off; insurance OFF → insurance_off; unreadable → error "nothing is broken" (en, hi, gu)', () => {
    expect(render(switchesState({ partner_console: false, insurance: true }))).toContain('data-kv-state="off"');
    const ins = render(switchesState({ partner_console: true, insurance: false }));
    expect(ins).toContain('data-kv-state="insurance_off"'); expect(text(ins)).toContain('Nothing is broken');
    const x = render(switchesState(null));
    expect(x).toContain('data-kv-state="error"'); expect(text(x)).toContain('Nothing is broken on the platform\'s side'); expect(x).not.toMatch(/unavailable|Prior packs/i);
    expect(text(render('ok', hi))).toContain(hi['partner2.reports.statement']); expect(text(render('ok', gu))).toContain(gu['partner2.reports.statement']);
  });
});
