// apps/web-ops/src/test-render/kiosk-earnings.render.test.tsx · PC-56 OPS-1c · W389 /kiosk/ambassador — her own earning rows, as returned.
// No total (none exists; none is computed), no rate, no "×" / "=", no %, no "Fri"; the runs omitted and SAID so; the managers' read said; the
// honest states; zero controls; the W389 refusals by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { KioskEarningsView } from '../components/ops1/KioskViews';
import { en } from '../i18n/en';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { text, tr, visible, percents } from './ops1a-fixtures';
import { NONE, controls } from './ops1b-fixtures';
import { EARNINGS_1C, FALSE_1C, SUMS_1C } from './ops1c-fixtures';

const T = tr(en);
const ok = renderToStaticMarkup(<KioskEarningsView t={T} lang="en" state="ok" rows={EARNINGS_1C} />);
const empty = renderToStaticMarkup(<KioskEarningsView t={T} lang="en" state="ok" rows={[]} />);
const states = (['none', 'off', 'error'] as const).map((s) => renderToStaticMarkup(<KioskEarningsView t={T} lang="en" state={s} rows={[]} />));

describe('PC-56 OPS-1c · /kiosk/ambassador prints her own earnings as the platform recorded them', () => {
  it('one row per earning, each amount through the formatter; no sum of any of them; no % and no "Fri"', () => {
    expect((ok.match(/data-kv-earning="/g) ?? []).length).toBe(EARNINGS_1C.length);
    for (const e of EARNINGS_1C) expect(text(ok)).toContain(formatMoneyMinor(e.amountMinor!, 'INR', 'en'));
    for (const s of SUMS_1C) expect([s, text(ok).includes(s)]).toEqual([s, false]);
    expect(percents(text(ok))).toBe(0);
    expect(/\bFri\b|[×=]/.test(visible(ok))).toBe(false);
  });
  it('says there is no total, that the pay runs are not hers to read here, and that her managers can read her earnings', () => {
    for (const h of [ok, empty, ...states]) {
      expect(text(h)).toContain('No total is shown: the platform returns none, and this page adds nothing up.');
      expect(text(h)).toContain(en['ops1.kiosk.earnings.runs']);
      expect(text(h)).toContain("Your organisation's ambassador managers can also read your earnings.");
    }
  });
  it('the honest states and the empty list; zero controls everywhere; no canon false word', () => {
    expect(text(empty)).toContain('No earnings are recorded for you yet.');
    expect(text(states[0])).toContain(en['ops1.kiosk.state.none']); expect(text(states[1])).toContain(en['ops1.kiosk.state.off']);
    expect(states[2]).toContain('data-kv-reread="/kiosk/ambassador"');
    for (const h of [ok, empty, ...states]) { expect(controls(h)).toEqual(NONE); expect(FALSE_1C.test(visible(h))).toBe(false); }
  });
  it('every W389 refusal is listed by name', () => {
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('kiosk_earnings'))) expect([r.id, ok.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
});
