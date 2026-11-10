// apps/web-gov/src/test-render/gov1b-chains.render.test.tsx · PC-56 GOV-1b — the three chain groups GOV-1b builds:
//   the DASHBOARD FORM (W3217–W3220, `?do=define&act=` on /dashboard): DECOR in every state — "Define a scheme" refused BY NAME, no form;
//   the DASHBOARD RE-READ (W3221–W3223, `?do=reread&act=`, opened by the error state's Retry): PARITY-DECOR — the confirm state's one link IS
//   the re-read of /dashboard; it writes nothing;
//   the CHROME RE-READ (W3214–W3216, `?act=` on /canon/chrome): PARITY-DECOR — the same, of /canon/chrome.
// Back → the page that opened it, ALWAYS (/dashboard, /canon/chrome — never /access, never the canon's "back to confirm"). Every state prints
// its refusals BY NAME and never the canon's shared chain sentences.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov1Chain } from '../components/gov1/Gov1Chain';
import { GOV1_CHAINS, gov1RefusalKeys, type Chain1Id } from '../features/gov1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';
import { FALSE_1B } from './gov1b-fixtures';

const CATS = { en, hi, gu } as const;
const chain = (id: Chain1Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov1Chain t={tr(cat)} chain={id} state={s} />);
const FORM = ['form-error', 'review', 'success', 'failure'];
const REREAD = ['confirm', 'success', 'failure'];

describe('PC-56 GOV-1b · the dashboard form chain (W3217–W3220) — DECOR', () => {
  it('every state: DECOR, "Define a scheme" refused BY NAME, no form, Back → /dashboard', () => {
    for (const s of FORM) {
      const h = chain('dashboard_form', s);
      expect(h).toContain(`data-kv-chain="dashboard_form" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain('Schemes are written by the platform\'s team, not from this console.');
      expect(h).not.toContain('<form'); expect(h).not.toContain('<input');
      expect(h).toContain('data-kv-back="/dashboard"'); expect(h).not.toMatch(/data-kv-back="\/(access|login)"/);
    }
    expect(text(chain('dashboard_form', 'success'))).toContain('No scheme was created or changed.');
  });
});

describe('PC-56 GOV-1b · the re-read chains (W3221–W3223 · W3214–W3216) — PARITY-DECOR', () => {
  it('the dashboard re-read: the confirm state\'s one link IS the re-read of /dashboard; Back → /dashboard (never /access); writes nothing', () => {
    const h = chain('dashboard_reread', 'confirm');
    expect(h).toContain('data-kv-chain-kind="PARITY-DECOR"'); expect(h).toContain('href="/dashboard" data-kv-real="reread"');
    expect(text(h)).toContain('Read the counts again'); expect(text(h)).toContain('Reading this page again writes nothing.');
    for (const s of REREAD) {
      const x = chain('dashboard_reread', s);
      expect([s, x.includes('data-kv-back="/dashboard"')]).toEqual([s, true]);
      expect([s, /data-kv-back="\/access"/.test(x)]).toEqual([s, false]);
      expect(x).not.toContain('<form');
    }
  });
  it('the chrome re-read: the confirm state\'s one link IS the re-read of /canon/chrome; Back → /canon/chrome', () => {
    const h = chain('chrome_reread', 'confirm');
    expect(h).toContain('href="/canon/chrome" data-kv-real="reread"'); expect(text(h)).toContain('Read this page again');
    for (const s of REREAD) expect([s, chain('chrome_reread', s).includes('data-kv-back="/canon/chrome"')]).toEqual([s, true]);
    expect(text(chain('chrome_reread', 'failure'))).toContain('This page loads no theme files, so nothing can fail to load.');
  });
});

describe('PC-56 GOV-1b · every 1b chain state, en/hi/gu', () => {
  const ONE_B = GOV1_CHAINS.filter((c) => c.wave === '1b');
  it('the registry\'s 1b chains are exactly these three', () => {
    expect(ONE_B.map((c) => c.id)).toEqual(['dashboard_form', 'dashboard_reread', 'chrome_reread']);
  });
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word', (_l, cat) => {
    for (const c of ONE_B) for (const s of c.states) {
      const h = chain(c.id, s, cat); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(cat[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(cat[c.statement])]).toEqual([c.id, s, true]);
      for (const k of gov1RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(cat[k])]).toEqual([c.id, s, k, true]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, FALSE_1B.test(visible(h))]).toEqual([c.id, s, false]);
    }
  });
});
