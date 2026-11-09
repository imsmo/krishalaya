// apps/web-ops/src/test-render/chc-insights.render.test.tsx · PC-56 OPS-4a · W409 — HONEST: the page reads nothing (its component takes no data at
// all), says no revenue, utilisation, subsidy or month-to-date figure is computed, that hours are typed, and that nothing is compared across
// organisations; its Retry is DECOR (→ the chain state that says there is nothing to read again); zero inputs.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChcInsightsView } from '../components/ops4/ChcViews';
import { Ops4Chain } from '../components/ops4/Ops4Chain';
import { en } from '../i18n/en';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_4A, MATH_4A, affirmed } from './ops4a-fixtures';

describe('PC-56 OPS-4a · chc-insights (W409)', () => {
  const h = renderToStaticMarkup(<ChcInsightsView t={tr(en)} />);
  it('reads nothing — the component takes no data — and says what is not built', () => {
    expect(ChcInsightsView.length).toBe(1);
    expect(text(h)).toContain('This page reads nothing.');
    expect(text(h)).toContain('No revenue, utilisation, subsidy or month-to-date figure for machine hire is computed on this platform, so none is shown.');
    expect(text(h)).toContain('Hours on a hire are typed by the machine\'s owner; no meter on this platform reads them.');
    expect(text(h)).toContain('Nothing here compares your organisation with another.');
    expect(/₹|\d/.test(visible(h))).toBe(false);
    expect(FALSE_4A.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
    expect(/<input|<select|<textarea|<form|<button/.test(h)).toBe(false);
  });
  it('Retry is DECOR: its chain state says there is nothing to read again, and offers no re-read', () => {
    expect(h).toContain('href="/chc/insights?act=confirm"'); expect(h).toContain('data-kv-decor="retry"');
    const c = renderToStaticMarkup(<Ops4Chain t={tr(en)} chain="chc_act" state="confirm" page="/chc/insights" reads={false} />);
    expect(c).toContain('data-kv-chain-kind="DECOR"'); expect(text(c)).toContain('This page reads nothing, so there is nothing to read again.');
    expect(c).not.toContain('data-kv-real="reread"'); expect(c).toContain('data-kv-back="/chc/insights"');
  });
});
