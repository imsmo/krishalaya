// apps/web-ops/src/test-render/kiosk-steps.render.test.tsx · PC-56 OPS-1c · W382–W388 — HONEST PAGES THAT READ NOTHING. Each statement ×3; zero
// controls; no promise of a code to her at a desk act; no helpline or USSD number; the summary's ₹0 sentence VERBATIM ×3 (Q4-A′) and never
// "member"; the helpline "not published yet" (Q11-A); the four canon "Retry" pages (W382, W384, W386 — and W380) a plain re-read link.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KIOSK_STEP_PAGES, KioskStepView, KioskSummaryView, type KioskStepSurface } from '../components/ops1/KioskViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { text, tr, visible } from './ops1a-fixtures';
import { NONE, controls } from './ops1b-fixtures';
import { FALSE_1C } from './ops1c-fixtures';

const CATS = { en, hi, gu } as const;
const STEPS = Object.keys(KIOSK_STEP_PAGES) as KioskStepSurface[];

describe('PC-56 OPS-1c · W382–W387 say what she does in her own sign-in, and why the desk does not', () => {
  it.each(STEPS.map((s) => [s]))('%s: statement + why ×3, zero controls, no canon false word, every refusal by name', (surface) => {
    const stem = KIOSK_STEP_PAGES[surface].stem;
    for (const [lang, cat] of Object.entries(CATS)) {
      const html = renderToStaticMarkup(<KioskStepView t={tr(cat)} surface={surface} />);
      for (const k of [`ops1.kiosk.${stem}.title`, `ops1.kiosk.${stem}.statement`, `ops1.kiosk.${stem}.why`]) expect([lang, k, text(html).includes(cat[k])]).toEqual([lang, k, true]);
      expect([lang, controls(html)]).toEqual([lang, NONE]);
      if (lang === 'en') {
        expect(FALSE_1C.test(visible(html))).toBe(false);
        for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes(surface))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
      }
    }
  });
  it('every statement says SHE does it herself and the desk does not (no OTP promise on a desk act)', () => {
    for (const s of STEPS) {
      const v = en[`ops1.kiosk.${KIOSK_STEP_PAGES[s].stem}.statement`];
      expect([s, /herself/.test(v), /\bOTP\b/.test(v)]).toEqual([s, true, false]);
    }
  });
  it('the canon "Retry" pages (W382, W384, W386) carry a plain re-read link to themselves — a GET, never a form', () => {
    for (const s of STEPS) {
      const html = renderToStaticMarkup(<KioskStepView t={tr(en)} surface={s} />);
      const p = KIOSK_STEP_PAGES[s];
      expect([s, html.includes(`data-kv-reread="${p.href}"`)]).toEqual([s, p.reread]);
    }
    expect(STEPS.filter((s) => KIOSK_STEP_PAGES[s].reread)).toEqual(['kiosk_profile', 'kiosk_kyc', 'kiosk_listing']);
    expect(renderToStaticMarkup(<KioskStepView t={tr(en)} surface="kiosk_profile" />)).toContain('href="/kiosk/session-start"');
  });
});

describe('PC-56 OPS-1c · W388 the summary says what is true (Q4-A′, Q11-A)', () => {
  it.each(Object.entries(CATS))('%s: what the desk did, the ₹0 sentence verbatim, the helpline line, the undo line; zero controls; no digit, no ₹', (_l, cat) => {
    const html = renderToStaticMarkup(<KioskSummaryView t={tr(cat)} />);
    for (const k of ['ops1.kiosk.summary.did', 'ops1.kiosk.summary.pay', 'ops1.kiosk.summary.helpline', 'ops1.kiosk.summary.undo']) expect([k, text(html).includes(cat[k])]).toEqual([k, true]);
    expect(controls(html)).toEqual(NONE);
    expect(/\d|₹/.test(visible(html))).toBe(false);
    expect(/1800-|\*123#/.test(html)).toBe(false);
  });
  it('en verbatim: "Creating your account at this desk pays the helper nothing, and you pay nothing." — never "member", never a number', () => {
    const html = renderToStaticMarkup(<KioskSummaryView t={tr(en)} />);
    expect(text(html)).toContain('Creating your account at this desk pays the helper nothing, and you pay nothing.');
    expect(text(html)).toContain("Your organisation's helpline is not published yet.");
    expect(/\bmember/i.test(visible(html))).toBe(false);
    expect(FALSE_1C.test(visible(html))).toBe(false);
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('kiosk_summary'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
});
