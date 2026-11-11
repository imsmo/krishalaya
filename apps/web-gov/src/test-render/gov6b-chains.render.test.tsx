// apps/web-gov/src/test-render/gov6b-chains.render.test.tsx · PC-56 GOV-6b — the five chain groups GOV-6b builds, all query states of /access:
//   record FILE (W3206–W3207, `?do=record-file`) — DECOR: no file of the record is queued, made or handed out (Q4's sentence);
//   record RE-READ (W3208–W3210, `?do=record-reread`) — PARITY-DECOR: confirm's one extra link IS a re-read of /access (Q2's sentence);
//   outside FILE (W3244–W3245, `?do=outside-file`) — DECOR (Q3); outside FORM (W3246–W3249, `?do=outside-form`) — DECOR: "New extract
//   request" refused by name, no form exists (Q3); outside RE-READ (W3250–W3252, `?do=outside-reread`) — PARITY-DECOR (Q3).
// Back → /access from every state (never /audit, /regulator/* or another page). Every state prints its statement and its refusals BY NAME,
// never the canon's shared chain sentences or the regulator console's chrome; no form, input or button anywhere; no digit.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov6Chain } from '../components/gov6/DashboardSections';
import { chain6For, chain6State, GOV6_CHAINS, gov6RefusalKeys, type Chain6Id } from '../features/gov6/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const CHAINS_6B = GOV6_CHAINS.filter((c) => c.wave === '6b');
const chain = (id: Chain6Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov6Chain t={tr(cat)} chain={id} state={s} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];
const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const Q2 = 'Every opening of an application on this console and every step taken on one is recorded, with who did it and when, in the farmer\'s organisation\'s records. This console shows that record to no one.';
const Q3 = 'No regulator, auditor or other outside body can sign in to this console or receive data from it.';
const Q4 = 'This console publishes nothing, sends no reports and makes no files. Nothing on it can be downloaded.';
/** The 6b chains' false words in visible text (outside the refusal list), beyond each chain's own statement and body. */
const FALSE_6B_CHAIN = /₹|%|rupee|regulat|auditor|supervis|dual grant|scope|pseudonym|re-?identif|real name|countersign|\bDPO\b|data room|extract|signed|signature|watermark|hash|chain|tamper|immutable|trail|audit|\bRTI\b|court|publish|export|download|reconcile|zero-sum|on-call|back to confirm|signed URL|sha256|position and ETA|two-person|maker-checker|precedent|template|loan|claim|borrower|policyholder/i;

describe('PC-56 GOV-6b · the record and outside-body chains', () => {
  it('five chains, all 6b, on /access: record file DECOR, record re-read PARITY-DECOR, outside file DECOR, outside form DECOR, outside re-read PARITY-DECOR', () => {
    expect(CHAINS_6B.map((c) => [c.id, c.kind, c.group, c.page, c.back, c.doing, c.statement])).toEqual([
      ['record_file', 'DECOR', 'audit_export', 'access', '/access', 'record-file', 'gov6.q4'],
      ['record_reread', 'PARITY-DECOR', 'audit_mutate', 'access', '/access', 'record-reread', 'gov6.q2'],
      ['outside_file', 'DECOR', 'regulator_export', 'access', '/access', 'outside-file', 'gov6.q3'],
      ['outside_form', 'DECOR', 'regulator_form', 'access', '/access', 'outside-form', 'gov6.q3'],
      ['outside_reread', 'PARITY-DECOR', 'regulator_mutate', 'access', '/access', 'outside-reread', 'gov6.q3'],
    ]);
    // each page answers only its own chains: a 6b `do=` opens nothing on /dashboard, a 6a `do=` nothing on /access; /access's own `do=` stay its own
    expect([chain6For({ do: 'record-file' }, 'access'), chain6For({ do: 'record-file' }), chain6For({ do: 'report-form' }, 'access'), chain6For({ do: ['outside-form'] }, 'access')]).toEqual(['record_file', null, null, 'outside_form']);
    expect(['request', 'approve', 'remove', 'reread', 'signins-file', 'signins-reread'].map((d) => chain6For({ do: d }, 'access'))).toEqual([null, null, null, null, null, null]);
    expect([chain6State('outside_form', { act: 'review' }), chain6State('outside_form', { act: 'confirm' }), chain6State('record_file', { act: 'ready' })]).toEqual(['review', null, 'ready']);
  });
  it('the file chains (DECOR): no file is made; their statement; one link (Back → /access)', () => {
    for (const [id, q] of [['record_file', Q4], ['outside_file', Q3]] as const) for (const s of ['queued', 'ready']) {
      const h = chain(id, s);
      expect(h).toContain(`data-kv-chain="${id}" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain(q); expect(text(h)).toContain('No file is queued, made or handed out here.');
      expect(hrefs(h)).toEqual(['/access']); expect(backOf(h)).toBe('/access'); expect(text(h)).toContain('Back to access');
    }
    expect(text(chain('record_file', 'queued'))).toContain('No file of the record is made here.');
    expect(text(chain('record_file', 'ready'))).toContain('No file of the record exists here.');
    expect(text(chain('outside_file', 'ready'))).toContain('No file for an outside body exists here.');
    expect(text(chain('outside_file', 'queued'))).toContain('Nothing is handed to an outside body from here, as a file or in any other way.');
    expect(text(chain('outside_file', 'queued'))).toContain('There is no separate console for an outside body, and no one uses this one as an outside body.');
  });
  it('the outside form chain (DECOR): "New extract request" refused by name; no form; Back only', () => {
    for (const s of ['form-error', 'review', 'success', 'failure']) {
      const h = chain('outside_form', s);
      expect(text(h)).toContain(Q3); expect(text(h)).toContain('No outside body can ask this console for data; there is no request form.');
      expect(text(h)).toContain('Back returns to this page; no form exists to go back to.');
      expect(hrefs(h)).toEqual(['/access']); expect(h).not.toContain('data-kv-real');
    }
    expect(text(chain('outside_form', 'success'))).toContain('No request was made or answered, and nothing was written.');
    expect(text(chain('outside_form', 'form-error'))).toContain('No outside body can ask for data here, so there is no form to correct.');
  });
  it('the re-read chains (PARITY-DECOR): confirm\'s extra link IS the re-read of /access; success and failure: Back only', () => {
    for (const id of ['record_reread', 'outside_reread'] as const) {
      const c = chain(id, 'confirm');
      expect(c).toContain(`data-kv-chain="${id}" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="confirm"`);
      expect(c).toContain('href="/access" data-kv-real="reread"'); expect(hrefs(c)).toEqual(['/access', '/access']);
      expect(text(c)).toContain('Read the access page again'); expect(text(c)).toContain('Reading this page again writes nothing.');
      for (const s of ['success', 'failure']) { const h = chain(id, s); expect(hrefs(h)).toEqual(['/access']); expect(h).not.toContain('data-kv-real'); expect(backOf(h)).toBe('/access'); }
      expect(text(chain(id, 'failure'))).toContain('No one is paged when this fails.');
      expect(text(chain(id, 'success'))).toContain('No money moves on this console.');
      expect(text(chain(id, 'success'))).toContain('Nothing is written from this page, so there is no entry to view.');
    }
    expect(text(chain('record_reread', 'confirm'))).toContain(Q2);
    expect(text(chain('record_reread', 'confirm'))).toContain('Reading again only opens the access page again; the record is still shown to no one.');
    expect(text(chain('outside_reread', 'confirm'))).toContain(Q3);
  });
  it('no state links anywhere but /access; the 6a chains are untouched (still /dashboard, their own Back words)', () => {
    for (const c of CHAINS_6B) for (const s of c.states) for (const href of hrefs(chain(c.id, s))) expect([c.id, s, href]).toEqual([c.id, s, '/access']);
    const a = chain('report_reread', 'confirm');
    expect(hrefs(a)).toEqual(['/dashboard', '/dashboard']); expect(text(a)).toContain('Back to your authority\'s schemes'); expect(text(a)).toContain('Read your authority\'s schemes again');
  });
});

describe('PC-56 GOV-6b · every 6b chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word; no form; no digit', (_l, cat) => {
    const c6 = cat as Record<string, string>;
    for (const c of CHAINS_6B) for (const s of c.states) {
      const h = chain(c.id, s, c6); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(c6[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(c6[c.statement]), t.includes(c6['gov6.chain.backAccess'])]).toEqual([c.id, s, true, true]);
      expect([c.id, s, t.split(c6[c.statement]).length - 1]).toEqual([c.id, s, 1]);
      for (const k of gov6RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(c6[k])]).toEqual([c.id, s, k, true]);
      const own = visible(h).replace(text(`<p>${c6[c.statement]}</p>`), ' ').replace(text(`<p>${c6[`${c.key(s)}.body`]}</p>`), ' ');
      if (c6 === en) expect([c.id, s, FALSE_6B_CHAIN.test(own)]).toEqual([c.id, s, false]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|signed URL|sha256|position and ETA|maker-checker|Two-person|READ-ONLY|Supervisory user|dual grant|both signatures/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, /<form|<input|<button/.test(h)]).toEqual([c.id, s, false]);
      expect([c.id, s, /[0-9०-९૦-૯]/.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, /gov6\.|gov4\.|common\./.test(t)]).toEqual([c.id, s, false]);
    }
  });
});
