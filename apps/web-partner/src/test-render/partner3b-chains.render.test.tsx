// apps/web-partner/src/test-render/partner3b-chains.render.test.tsx · PC-56 PARTNER-3b — the six DECOR act chains (W2866–W2868 evidence,
// W2904–W2906 surveyors, W2934–W2936 fraud, W3014–W3016 survey) over six triggering pages. Each has ONE state, `?act=confirm`, whose body is
// the founder's own sentence keyed exactly `partner3.chain.act3b.confirm`; each prints its surface's refusals by name and links back to the page
// it was opened FROM (never the canon's "Back → W255 from W256" or "W258 from W259" — DELTA `chain_returns_3b`). No form, no act, no money, no
// percentage, no export note.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerClaimsChain } from '../components/partner3/InsurerClaimsChain';
import { PARTNER3_CHAINS, partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';
import { FALSE_3B } from './partner3b-fixtures';

const CHAINS_3B = PARTNER3_CHAINS.filter((c) => c.wave === '3b');
/** The page each chain was opened from (an `[id]` chain is passed its own URL, as its page does). */
const BACK: Record<string, string> = {
  evidence_board_act: '/insurer/claims/evidence/0192d2c4-c001-7000-8000-000000000001',
  survey_report_act: '/insurer/surveys/0192d2c4-c001-7000-8000-000000000001/report',
};
const STATEMENT = 'This action is not available from the partner console: evidence, surveys and surveyors are handled by the organisation that serves the farmer, and no fraud flag exists on the platform. Nothing was changed.';

describe('PC-56 PARTNER-3b · the six DECOR act chains (render)', () => {
  it('six chains, twelve canon pages, every one DECOR with ONE state', () => {
    expect(CHAINS_3B.map((c) => c.id)).toEqual(['evidence_act', 'evidence_board_act', 'surveyors_act', 'surveys_act', 'survey_report_act', 'fraud_act']);
    expect(CHAINS_3B.flatMap((c) => c.files)).toEqual(['W2866', 'W2867', 'W2868', 'W2904', 'W2905', 'W2906', 'W3014', 'W3015', 'W3016', 'W2934', 'W2935', 'W2936']);
    expect(CHAINS_3B.every((c) => c.states.length === 1 && c.states[0] === 'confirm')).toBe(true);
  });
  for (const c of CHAINS_3B) {
    it(`${c.id} · confirm: the founder's sentence, its refusals, the way back to the page it was opened from — nothing written`, () => {
      const back = BACK[c.id];
      const html = renderToStaticMarkup(<InsurerClaimsChain t={tr(en)} chain={c.id} state="confirm" back={back} />); const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(html).toContain('data-kv-chain-state="confirm"');
      expect(html).toContain('data-kv-statement="partner3.chain.act3b.confirm"');
      expect(w).toContain(en['partner3.chain.act3b.title']);
      expect(w).toContain(STATEMENT); expect(w).toContain(en['partner3.chain.act3b.confirm']);
      for (const k of partner3RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${back ?? c.page}"`); expect(html).toContain(`data-kv-back="${back ?? c.page}"`);
      expect(html).not.toContain('[id]');
      expect(html).not.toContain('<form'); expect(html).not.toContain('<button');
      expect(html).not.toMatch(/back to confirm|W255|W256|W257|W258|W259|W263/i);
      expect(html).not.toContain('data-kv-export-note');
      expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(text(withoutRefusals(html))).not.toMatch(FALSE_3B);
      expect(w).not.toMatch(MONEY); expect(percents(w)).toBe(0);
      for (const cat of [hi, gu]) {
        const o = text(renderToStaticMarkup(<InsurerClaimsChain t={tr(cat)} chain={c.id} state="confirm" />));
        expect(o).toContain(cat['partner3.chain.act3b.confirm']); expect(o).not.toContain(STATEMENT);
      }
    });
  }
  it('without a back link an `[id]` chain falls back to its parent list page — never a route pattern', () => {
    expect(renderToStaticMarkup(<InsurerClaimsChain t={tr(en)} chain="evidence_board_act" state="confirm" />)).toContain('href="/insurer/claims/evidence"');
    expect(renderToStaticMarkup(<InsurerClaimsChain t={tr(en)} chain="survey_report_act" state="confirm" />)).toContain('href="/insurer/surveys"');
  });
  it('the 3a chains are untouched: they still print their own `<key>.title` / `<key>.body`, not the 3b statement', () => {
    const a = renderToStaticMarkup(<InsurerClaimsChain t={tr(en)} chain="claims_act" state="confirm" />);
    expect(text(a)).toContain(en['partner3.chain.act.confirm.body']);
    expect(a).not.toContain('data-kv-statement="partner3.chain.act3b.confirm"');
    expect(text(a)).not.toContain(STATEMENT);
  });
});
