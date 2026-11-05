// apps/web-partner/src/test-render/lender-reports.render.test.tsx · PC-56 PARTNER-5c · W214 (canon `lender/reports`, founder 5c-1) — the
// SLA page renders the TWO real things and refuses everything else by name:
//   • the platform's published decision promise in its own sentence, both ways (published / not published), and who sets it;
//   • the measured decision time as COUNTS (decided; within the promise; after the promise = decided − within) and two DURATIONS (whole
//     hours and minutes) — no "%", no rate, no ratio, no share, no decimal anywhere in the HTML (M4 kills here);
//   • the production-zero reason verbatim; the partners mailbox line where the canon prints packs and escalations;
//   • Export = DECOR → `?export=queued`; Retry (error state) → `?act=confirm`; "View dashboard" a REAL link to /dashboard;
//   • states: ok, empty (nothing decided — the zero reason), error (the Retry chain), switched-off (OFF as OFF, "nothing is broken").
// Never "your contract".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderReportsView } from '../components/partner5/LenderReportsView';
import { partner5RefusalKeys } from '../features/partner5/refusals';
import { slaState, type Lender5State, type SlaShape } from '../features/partner5/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { COMPUTED_AT, FALSE_5C, MAILBOX, SLA, SLA_EMPTY, SLA_NONE } from './partner5c-fixtures';

const render = (state: Lender5State, sla: SlaShape | null = SLA, cat: Record<string, string> = en, mailbox: Parameters<typeof LenderReportsView>[0]['mailbox'] = MAILBOX) =>
  renderToStaticMarkup(<LenderReportsView t={tr(cat)} lang="en" state={state} sla={sla} computedAt={sla ? COMPUTED_AT : null} orgName="Fixture Lending Partner" mailbox={mailbox} />);
const fill = (k: string, vars: Record<string, string | number>) => en[k].replace(/\{(\w+)\}/g, (_m, n) => String(vars[n]));

describe('PC-56 PARTNER-5c · W214 the SLA page (render)', () => {
  it('ok: the published promise in its own sentence, who sets it, the counts, the two durations, the zero reason, the as-of', () => {
    const html = render(slaState(SLA, null)); const w = text(html);
    expect(html).toContain('data-kv-lender="reports"'); expect(html).toContain('data-kv-state="ok"');
    expect(w).toContain('Fixture Lending Partner');
    expect(w).toContain('The platform has published a decision promise of 24 hours for your organisation.');
    expect(w).toContain('The platform sets this promise; it is not changed from this console.');
    expect(w).toContain(fill('partner5.sla.measuredTitle', { days: 30 }));
    expect(w).toContain('Applications decided: 2');
    expect(w).toContain('Decided within the promise: 1 of 2');
    expect(w).toContain('Decided after the promise: 1 of 2');
    expect(w).toContain('Median time to a decision: 10 h 0 min');
    expect(w).toContain('Nine decisions in ten took no longer than: 30 h 15 min');
    expect(w).toContain(en['partner5.sla.zeroReason']);
    expect(html).toContain(`data-kv-asof="${COMPUTED_AT}"`);
    expect(w).toContain(en['partner5.sla.liveNote']);
  });
  it('no promise published: the "not published" sentence, and NO within / after line (there is nothing to be within)', () => {
    const html = render('ok', SLA_NONE); const w = text(html);
    expect(w).toContain('The platform has not published a decision promise for your organisation.');
    expect(html).toContain('data-kv-sla-promise="none"');
    expect(html).not.toMatch(/data-kv-sla-(within|after)=/);
    expect(text(withoutRefusals(html))).not.toMatch(/within the promise|after the promise/);   // the refusal list names them only to refuse
    expect(w).toContain('Applications decided: 2');
    expect(w).toContain(en['partner5.sla.promiseSetBy']);
  });
  it('NO percentage, rate, ratio, share or decimal ANYWHERE in the HTML (M4 kills here), and never "your contract"', () => {
    for (const [state, sla] of [['ok', SLA], ['ok', SLA_NONE], ['empty', SLA_EMPTY], ['error', null]] as const) {
      for (const cat of [en, hi, gu]) {
        const html = render(state, sla, cat); const w = text(html);
        expect([state, html.includes('%'), percents(w)]).toEqual([state, false, 0]);
        expect([state, /\b\d+[.,]\d+\b/.test(w.replace(/\d{1,2}:\d{2}/g, '').replace(/\d{4}/g, ''))]).toEqual([state, false]);
      }
      const visible = text(withoutRefusals(render(state, sla)));
      expect([state, FALSE_5C.test(visible)]).toEqual([state, false]);
      expect(text(render(state, sla))).not.toMatch(/your contract/i);
    }
  });
  it('the refusals by name; the partners mailbox line in place of packs and escalations; Export DECOR; View dashboard REAL', () => {
    const html = render('ok'); const w = text(html);
    const keys = partner5RefusalKeys('sla');
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const k of ['partner5.refusal.yourContract', 'partner5.refusal.disbursalPromise', 'partner5.refusal.decisionRate', 'partner5.refusal.borrowerSatisfaction',
      'partner5.refusal.conductCount', 'partner2.refusal.reportPack', 'partner5.refusal.escalations', 'partner4.refusal.platformRoles', 'partner4.refusal.planSettings']) expect(keys).toContain(k);
    expect(html).toContain('data-kv-ops-mailbox="published"'); expect(html).toContain('partners@example.org');
    expect(w).toContain(en['partner1.ops.mailbox']); expect(w).toContain(en['partner5.sla.contactBody']);
    expect(html).toContain('href="/lender/reports?export=queued"'); expect(html).toContain('data-kv-decor="export"');
    expect(html).toContain('href="/dashboard"'); expect(html).toContain('data-kv-real="dashboard"');
    // an unpublished mailbox says so — never an address literal
    expect(text(render('ok', SLA, en, { kind: 'none' }))).toContain(en['partner1.ops.mailboxNone']);
    expect(html).not.toMatch(/<input|<select|<textarea|<form|<button/);
  });
  it('empty (nothing decided in the window): the none-decided sentence and the production-zero reason; no duration, no count lines', () => {
    const html = render(slaState(SLA_EMPTY, null), SLA_EMPTY); const w = text(html);
    expect(html).toContain('data-kv-state="empty"');
    expect(w).toContain(fill('partner5.sla.noneDecided', { days: 30 }));
    expect(w).toContain(en['partner5.sla.zeroReason']);
    expect(w).toContain('The platform has published a decision promise of 24 hours for your organisation.');
    expect(w).not.toMatch(/Median time|Nine decisions in ten|Applications decided/);
  });
  it('error: nothing changed + Retry = the PARITY-DECOR re-read chain; no figure, no promise sentence', () => {
    const html = render(slaState(null, 'error'), null); const w = text(html);
    expect(html).toContain('data-kv-state="error"'); expect(html).toContain('role="alert"');
    expect(w).toContain(en['partner5.sla.error.body']);
    expect(html).toContain('href="/lender/reports?act=confirm"'); expect(html).toContain('data-kv-retry="sla"');
    expect(w).not.toContain('decision promise of');
  });
  it('switched off (`partner_console` OFF): "switched off … nothing is broken" — never "lending is off", never plan settings', () => {
    const html = render(slaState(null, 'off'), null); const w = text(html);
    expect(html).toContain('data-kv-state="off"');
    expect(w).toContain(en['partner.off.title']); expect(w).toContain('Nothing is broken');
    expect(w).not.toMatch(/lending is off|see plan settings|unavailable/i);
  });
  // PC-56 PARTNER-6b · NAMED UPDATE (founder 6b-3, survey F-10): W224 was a total orphan — W214 now links to it, a REAL link in every state
  // but switched-off (there is no page to go to when the console is off)
  it('PC-56 PARTNER-6b · the REAL "Regulatory reporting" link to /lender/reports/regulatory in ok, empty and error; none when switched off', () => {
    for (const [state, sla] of [['ok', SLA], ['empty', SLA_EMPTY], ['error', null]] as const) for (const cat of [en, hi, gu]) {
      const html = render(state, sla, cat);
      expect([state, html.includes('href="/lender/reports/regulatory"'), html.includes('data-kv-real="regulatory"')]).toEqual([state, true, true]);
      expect(text(html)).toContain(cat['partner6.regulatory.fromReports']);
    }
    expect(render('off', null)).not.toContain('/lender/reports/regulatory');
    expect(FALSE_5C.test(en['partner6.regulatory.fromReports'])).toBe(false);
  });
  it('hi and gu render the same skeleton with their own words', () => {
    const skel = (h: string) => (h.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
    expect(skel(render('ok', SLA, hi))).toBe(skel(render('ok')));
    expect(skel(render('ok', SLA, gu))).toBe(skel(render('ok')));
    expect(text(render('ok', SLA, hi))).toContain(hi['partner5.sla.zeroReason']);
    expect(text(render('ok', SLA, gu))).toContain('24 કલાક');
  });
});
