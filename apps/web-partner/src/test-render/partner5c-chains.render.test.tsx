// apps/web-partner/src/test-render/partner5c-chains.render.test.tsx · PC-56 PARTNER-5c — the SLA page's two chains, in every state:
//   • W3009–W3010 (`/lender/reports?export=`)  DECOR — no pack and no export plane: the mailbox line and the mailbox FACT (M5 kills here);
//   • W3011–W3013 (`/lender/reports?act=`)     PARITY-DECOR — Retry is a genuine re-read of the promise and the decision times.
// Each state prints its own sentence and its refusals and links BACK to `/lender/reports`. No form, no act, no money, no "%".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderChain5 } from '../components/partner5/LenderChain5';
import { PARTNER5_CHAINS, partner5RefusalKeys } from '../features/partner5/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_5C, MAILBOX } from './partner5c-fixtures';

const CHAINS_5C = PARTNER5_CHAINS.filter((c) => c.wave === '5c');

describe('PC-56 PARTNER-5c · the two SLA chains (render)', () => {
  it('TWO chain entries, FIVE canon pages, each recorded once on the triggering page', () => {
    expect(CHAINS_5C.map((c) => [c.id, c.page, c.param, !!c.mailbox])).toEqual([['sla_export', '/lender/reports', 'export', true], ['sla_act', '/lender/reports', 'act', false]]);
    expect(CHAINS_5C.flatMap((c) => c.files)).toEqual(['W3009', 'W3010', 'W3011', 'W3012', 'W3013']);
  });
  for (const c of CHAINS_5C) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its own sentence, its refusals, Back to /lender/reports`, (state) => {
      const html = renderToStaticMarkup(<LenderChain5 t={tr(en)} chain={c.id} state={state} mailbox={MAILBOX} />);
      const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]); expect(w).toContain(en[`${c.key(state)}.body`]);
      const keys = partner5RefusalKeys(c.surface);
      expect(keys.length).toBeGreaterThanOrEqual(4);
      for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain('data-kv-back="/lender/reports"');
      expect(html).not.toMatch(/<input|<select|<label|<form|<button|<textarea/);
      expect(percents(w)).toBe(0); expect(html).not.toContain('%');
      expect(MONEY.test(w)).toBe(false);
      expect(FALSE_5C.test(text(withoutRefusals(html)))).toBe(false);
      if (c.mailbox) {
        expect(html).toContain('data-kv-export-note="true"');
        expect(w).toContain(en['partner4.export.notAvailable']);
        expect(html).toContain('partners@example.org');
        expect(html).toContain('data-kv-ops-mailbox="published"');
        expect(w).not.toMatch(/sha256|checksum|signed URL|row count/i);
      } else {
        expect(html).not.toContain('data-kv-export-note');
        expect(html).not.toContain('partners@example.org');
      }
    });
  }
  it('the act chain is PARITY-DECOR: Retry is a genuine re-read, with no confirm step and no audit row of its own; the export names the pack only to refuse it', () => {
    const body = en['partner5.chain.slaAct.confirm.body'];
    expect(body).toMatch(/genuine re-read/); expect(body).toMatch(/no confirm step/); expect(body).toMatch(/no audit row of its own/);
    expect(partner5RefusalKeys('sla_export')).toEqual(expect.arrayContaining(['partner2.refusal.reportPack', 'partner5.refusal.slaExportFile', 'partner4.refusal.exportFile']));
    expect(partner5RefusalKeys('sla_act')).not.toContain('partner4.refusal.exportFile');
  });
  it('every state exists in hi and gu with the same markup skeleton', () => {
    for (const c of CHAINS_5C) for (const state of c.states) {
      const shapes = [en, hi, gu].map((cat) => {
        const html = renderToStaticMarkup(<LenderChain5 t={tr(cat)} chain={c.id} state={state} mailbox={MAILBOX} />);
        expect(text(html)).toContain(cat[`${c.key(state)}.body`]);
        expect(percents(text(html))).toBe(0);
        return (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
      });
      expect([c.id, state, new Set(shapes).size]).toEqual([c.id, state, 1]);
    }
  });
});
