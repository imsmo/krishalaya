// apps/web-gov/src/test-render/gov6a-chains.render.test.tsx · PC-56 GOV-6a — the five chain groups GOV-6a builds, all query states of /dashboard:
//   analytics FILE (W3201–W3202, `?do=analytics-file`) — DECOR: no deck or file of the counts is queued, made or handed out (Q4's sentence);
//   analytics RE-READ (W3203–W3205, `?do=analytics-reread`) — PARITY-DECOR: confirm's one extra link IS a re-read of /dashboard (Q1's sentence);
//   report FILE (W3253–W3254, `?do=report-file`) — DECOR (Q4); report FORM (W3255–W3258, `?do=report-form`) — DECOR: "New report" refused by
//   name, no form exists (Q4); report RE-READ (W3259–W3261, `?do=report-reread`) — PARITY-DECOR (Q4).
// Back → /dashboard from every state (never /analytics, /reports or another page). Every state prints its statement and its refusals BY NAME,
// never the canon's shared chain sentences; no form, input or button anywhere; no digit.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov6Chain } from '../components/gov6/DashboardSections';
import { chain6For, chain6State, GOV6_CHAINS, gov6RefusalKeys, type Chain6Id } from '../features/gov6/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const CHAINS_6A = GOV6_CHAINS.filter((c) => c.wave === '6a');
const chain = (id: Chain6Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov6Chain t={tr(cat)} chain={id} state={s} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];
const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const Q1 = 'This console counts applications only by scheme and by where each one is now. It does not count applicants by caste, gender, landholding or district, and it ranks no district or official.';
const Q4 = 'This console publishes nothing, sends no reports and makes no files. Nothing on it can be downloaded.';
/** The 6a chains' false words in visible text (outside the refusal list), beyond each chain's own statement and body. */
const FALSE_6A_CHAIN = /₹|%|rupee|caste|gender|district|median|funnel|decided|share|rate\b|publish|schedul|signed|signature|secretar|recipient|export|deck|audit|\bRTI\b|wall|reconcile|zero-sum|on-call|back to confirm|signed URL|sha256|position and ETA|two-person|maker-checker|template/i;

describe('PC-56 GOV-6a · the analytics and report chains', () => {
  it('five chains, all 6a, on /dashboard: analytics file DECOR, analytics re-read PARITY-DECOR, report file DECOR, report form DECOR, report re-read PARITY-DECOR', () => {
    expect(CHAINS_6A.map((c) => [c.id, c.kind, c.group, c.back, c.doing, c.statement])).toEqual([
      ['analytics_file', 'DECOR', 'analytics_export', '/dashboard', 'analytics-file', 'gov6.q4'],
      ['analytics_reread', 'PARITY-DECOR', 'analytics_mutate', '/dashboard', 'analytics-reread', 'gov6.q1'],
      ['report_file', 'DECOR', 'report_export', '/dashboard', 'report-file', 'gov6.q4'],
      ['report_form', 'DECOR', 'report_form', '/dashboard', 'report-form', 'gov6.q4'],
      ['report_reread', 'PARITY-DECOR', 'report_mutate', '/dashboard', 'report-reread', 'gov6.q4'],
    ]);
    // GOV-1b's own dashboard chains are not taken: `define` and `reread` stay GOV-1b's
    expect([chain6For({ do: 'define' }), chain6For({ do: 'reread' }), chain6For({}), chain6For({ do: ['report-form'] })]).toEqual([null, null, null, 'report_form']);
    expect([chain6State('report_form', { act: 'review' }), chain6State('report_form', { act: 'confirm' }), chain6State('analytics_file', { act: 'ready' })]).toEqual(['review', null, 'ready']);
  });
  it('the file chains (DECOR): no file is made; Q4\'s sentence; one link (Back → /dashboard)', () => {
    for (const id of ['analytics_file', 'report_file'] as const) for (const s of ['queued', 'ready']) {
      const h = chain(id, s);
      expect(h).toContain(`data-kv-chain="${id}" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain(Q4); expect(text(h)).toContain('No file is queued, made or handed out here.');
      expect(hrefs(h)).toEqual(['/dashboard']); expect(backOf(h)).toBe('/dashboard'); expect(text(h)).toContain('Back to your authority\'s schemes');
    }
    expect(text(chain('analytics_file', 'queued'))).toContain('No slide deck or other file of these counts is made or handed out.');
    expect(text(chain('analytics_file', 'ready'))).toContain('No file of these counts exists here.');
    expect(text(chain('report_file', 'ready'))).toContain('No report file exists here.');
    expect(text(chain('report_file', 'queued'))).toContain('No pack of counts is put together or sent to any office from here, and nothing here carries a signature.');
  });
  it('the report form chain (DECOR): "New report" refused by name; no form; Back only', () => {
    for (const s of ['form-error', 'review', 'success', 'failure']) {
      const h = chain('report_form', s);
      expect(text(h)).toContain(Q4); expect(text(h)).toContain('No report can be set up here, from a template or otherwise.');
      expect(text(h)).toContain('Back returns to this page; no form exists to go back to.');
      expect(hrefs(h)).toEqual(['/dashboard']); expect(h).not.toContain('data-kv-real');
    }
    expect(text(chain('report_form', 'success'))).toContain('No report was set up or sent, and nothing was written.');
    expect(text(chain('report_form', 'form-error'))).toContain('Reports are not set up on this console, so there is no form to correct.');
  });
  it('the re-read chains (PARITY-DECOR): confirm\'s extra link IS the re-read of /dashboard; success and failure: Back only', () => {
    for (const id of ['analytics_reread', 'report_reread'] as const) {
      const c = chain(id, 'confirm');
      expect(c).toContain(`data-kv-chain="${id}" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="confirm"`);
      expect(c).toContain('href="/dashboard" data-kv-real="reread"'); expect(hrefs(c)).toEqual(['/dashboard', '/dashboard']);
      expect(text(c)).toContain('Read your authority\'s schemes again'); expect(text(c)).toContain('Reading this page again writes nothing.');
      for (const s of ['success', 'failure']) { const h = chain(id, s); expect(hrefs(h)).toEqual(['/dashboard']); expect(h).not.toContain('data-kv-real'); expect(backOf(h)).toBe('/dashboard'); }
      expect(text(chain(id, 'failure'))).toContain('No one is paged when this fails.');
      expect(text(chain(id, 'success'))).toContain('No money moves on this console.');
    }
    expect(text(chain('analytics_reread', 'confirm'))).toContain(Q1);
    expect(text(chain('report_reread', 'confirm'))).toContain(Q4);
  });
  it('no state links anywhere but /dashboard', () => {
    for (const c of CHAINS_6A) for (const s of c.states) for (const href of hrefs(chain(c.id, s))) expect([c.id, s, href]).toEqual([c.id, s, '/dashboard']);
  });
});

describe('PC-56 GOV-6a · every 6a chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word; no form; no digit', (_l, cat) => {
    const c6 = cat as Record<string, string>;
    for (const c of CHAINS_6A) for (const s of c.states) {
      const h = chain(c.id, s, c6); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(c6[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(c6[c.statement]), t.includes(c6['gov6.chain.back'])]).toEqual([c.id, s, true, true]);
      expect([c.id, s, t.split(c6[c.statement]).length - 1]).toEqual([c.id, s, 1]);
      for (const k of gov6RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(c6[k])]).toEqual([c.id, s, k, true]);
      const own = visible(h).replace(text(`<p>${c6[c.statement]}</p>`), ' ').replace(text(`<p>${c6[`${c.key(s)}.body`]}</p>`), ' ');
      if (c6 === en) expect([c.id, s, FALSE_6A_CHAIN.test(own)]).toEqual([c.id, s, false]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|signed URL|sha256|position and ETA|maker-checker|Two-person/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, /<form|<input|<button/.test(h)]).toEqual([c.id, s, false]);
      expect([c.id, s, /[0-9०-९૦-૯]/.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, /gov6\.|common\./.test(t)]).toEqual([c.id, s, false]);
    }
  });
});
