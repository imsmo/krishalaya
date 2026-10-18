// apps/web-partner/src/test-render/onboarding.render.test.tsx · PC-56 PARTNER-1b · founder D3 (canon W266, W265, W2970–W2976) — your standing with
// the platform: the six facts true / false from the read, computedAt, "with the platform's partner operations" + the mailbox fact, the link
// to the settlement page; the settlement page: no account is collected in Phase 1, the FPO is the lender of record, the partner kind (TRUE
// vocabulary), every canon claim refused by name, NO input, and none of the false words (M6 kills here); the chains DECOR.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReadinessView } from '../components/partner1/ReadinessView';
import { SettlementView } from '../components/partner1/SettlementView';
import { ChainNotice } from '../components/partner1/ChainNotice';
import { partner1RefusalKeys } from '../features/partner1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_1B, NOT_READY, READY } from './partner1b-fixtures';

const MAIL = { kind: 'published' as const, address: 'ops@fixture.test' };

describe('PC-56 PARTNER-1b · W266 your standing with the platform (render)', () => {
  it('the six facts from the read: in place / with partner operations, the figures, computedAt, the mailbox fact, the settlement link', () => {
    const html = renderToStaticMarkup(<ReadinessView t={tr(en)} lang="en" state="ok" r={READY} mailbox={MAIL} />); const w = text(html);
    expect((html.match(/data-kv-fact="/g) ?? []).length).toBe(6);
    expect(html).toContain('data-kv-fact="administrators" data-kv-ready="yes"'); expect(html).toContain('data-kv-fact="sla" data-kv-ready="no"');
    expect(w).toContain('1 of your 2 administrators use an authenticator app.'); expect(w).toContain('Active API keys: 1.');
    expect(w).toMatch(/A delivery reached your server in the last 90 days — the latest at .*2026/); expect(w).toContain(en['partner1.readiness.sla.no']);
    expect(w).toContain('5 of 6 in place'); expect(w).toMatch(/as of .*2026/);
    expect(w).toContain(en['partner1.readiness.withOps']); expect(html).toContain('href="mailto:ops@fixture.test"');
    expect(html).toContain('href="/onboarding/settlement"');
    for (const k of partner1RefusalKeys('status')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).not.toMatch(FALSE_1B); expect(html).not.toContain('<input'); expect(html).not.toMatch(/type="checkbox"/);
  });
  it('nothing in place → each "with partner operations"; an administrator without a second factor is NOT in place', () => {
    const html = renderToStaticMarkup(<ReadinessView t={tr(en)} lang="en" state="ok" r={NOT_READY} mailbox={MAIL} />); const w = text(html);
    expect(html).toContain('data-kv-fact="administrators" data-kv-ready="no"');
    expect(w).toContain('None of your 1 administrators uses an authenticator app yet.'); expect(w).toContain(en['partner1.readiness.keys.no']);
    expect(w).toContain(en['partner1.readiness.endpoints.no']); expect(w).toContain('No delivery reached your server in the last 90 days.');
    expect(w).toContain('1 of 6 in place');
  });
  it('switched off says so ("nothing is broken"); an unreadable read says so; Hindi renders', () => {
    const off = text(renderToStaticMarkup(<ReadinessView t={tr(en)} lang="en" state="off" r={null} mailbox={MAIL} />));
    expect(off).toContain('Nothing is broken'); expect(off).not.toMatch(/unavailable/i);
    expect(text(renderToStaticMarkup(<ReadinessView t={tr(en)} lang="en" state="error" r={null} mailbox={MAIL} />))).toContain(en['partner1.readiness.error']);
    expect(text(renderToStaticMarkup(<ReadinessView t={tr(hi)} lang="hi" state="ok" r={READY} mailbox={MAIL} />))).toContain(hi['partner1.readiness.title']);
  });
});

describe('PC-56 PARTNER-1b · W265 the settlement page, honest (render)', () => {
  it('no account is collected in Phase 1; the FPO is the lender of record; the partner kind; refusals by name; no input; no false word', () => {
    const html = renderToStaticMarkup(<SettlementView t={tr(en)} kind="nbfc" />); const w = text(html);
    expect(w).toContain('No settlement account is collected in Phase 1.'); expect(w).toContain('lender of record');
    expect(w).toContain('Your partner kind: Non-banking finance company (NBFC).');
    for (const k of ['bank', 'nbfc', 'mfi', 'insurer', 'amc', 'gold_loan']) expect(w).toContain(en[`partner1.onboarding.kind.${k}`]);
    for (const k of partner1RefusalKeys('onboarding')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(html).not.toContain('<input'); expect(html).not.toContain('<form');
    expect(w).not.toMatch(FALSE_1B);
    expect(w).not.toMatch(/penny/i);
    expect(html).toContain('href="/onboarding/settlement?form=review"'); expect(html).toContain('href="/onboarding/settlement?act=confirm"');
    expect(html).toContain('href="/onboarding/status"');
    expect(text(renderToStaticMarkup(<SettlementView t={tr(en)} kind={null} />))).toContain(en['partner1.onboarding.kindUnknown']);
  });
  it('the chains (W2970–W2976) print the same refusal: nothing collected, nothing checked, back to the settlement page (never W253)', () => {
    for (const [chain, states] of [['onboarding_form', ['error', 'review', 'success', 'failure']], ['onboarding_act', ['confirm', 'success', 'failure']]] as const) {
      for (const s of states) {
        const html = renderToStaticMarkup(<ChainNotice t={tr(en)} chain={chain} state={s} />);
        expect(html).toContain('href="/onboarding/settlement"'); expect(html).not.toMatch(/W253|claim-detail/);
        expect(text(html)).toContain(en[partner1RefusalKeys('onboarding_chain').find((k) => k === 'partner1.refusal.onbAccountFields')!]);
        expect(text(html)).not.toMatch(/penny/i);
      }
    }
  });
});
