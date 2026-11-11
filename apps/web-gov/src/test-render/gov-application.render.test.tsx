// apps/web-gov/src/test-render/gov-application.render.test.tsx · PC-56 GOV-2c — W331 (`/applications/[id]`) and the act chain's pieces
// (W3159–W3161) as a person sees them: ONLY the declared fields of the version (personal ones as the API masked them; an undeclared key and the
// raw form never printed); Q1-A's, Q2-A's and Q3-A's sentences exact; the not-declared state in words; Approve / Reject offered to a head and
// HIDDEN from the person who checked it, made it or helped make it (when the facts say so) and from an officer; with no facts (the read gives
// none today) offered, with the sentence saying the API refuses by name; reject needs a listed reason AND a sentence; clarify a sentence; no
// figure anywhere; the lone-head fact; the named refusals ×3.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActDoneNote, ActFailureNote, ActForm, ApplicationDetailView } from '../components/gov2/ApplicationsViews';
import { gov2RefusalKeys } from '../features/gov2/refusals';
import type { ActFacts, AppState, DecisionFact } from '../features/gov2/applications';
import type { GovMe } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';
import { APP_1, FALSE_2C, HEAD_2C, MONEY_SENTINEL_2C, OFFICER_2C, OPENED, OPENED_DECIDED, OPENED_UNDECLARED, READER_2C, SCHEME_ID, UNDECLARED_SENTINEL } from './gov2c-fixtures';

const Q1 = 'Approving records the decision. It pays nothing: the benefit is paid by the government\'s own systems, outside this platform.';
const Q2 = 'A decision is made by a different person from the one who checked the application. Every step is recorded, and the farmer\'s organisation can see it.';
const Q3 = 'You see only what this scheme asks for. A farmer\'s personal details are hidden, and an application she has not sent is never shown.';
const CATS = { en, hi, gu } as const;
const NONE: ActFacts = { actorIsVerifier: false, actorIsApplicant: false, actorIsAssister: false };
const view = (o: { state?: AppState; me?: GovMe; app?: typeof OPENED | null; facts?: ActFacts | null; decision?: DecisionFact; cat?: Record<string, string> } = {}) =>
  renderToStaticMarkup(<ApplicationDetailView t={tr(o.cat ?? en)} state={o.state ?? 'ok'} me={o.me ?? HEAD_2C} id={APP_1} app={o.app === undefined ? OPENED : o.app}
    facts={o.facts === undefined ? NONE : o.facts} decision={o.decision ?? null} />);
const offers = (h: string) => [...h.matchAll(/data-kv-offer="(\w+)"/g)].map((m) => m[1]);
const noop = '/applications/act';   // a string action: renderToStaticMarkup cannot print a Server Action

describe('PC-56 GOV-2c · W331 — one application, declared fields only (Q3-A)', () => {
  it('Q1-A, Q2-A and Q3-A verbatim (en) and printed whole in hi / gu', () => {
    const t = text(view());
    expect(t).toContain(Q1); expect(t).toContain(Q2); expect(t).toContain(Q3);
    for (const cat of [hi, gu]) { const x = text(view({ cat })); for (const k of ['gov2.q1', 'gov2.q2', 'gov2.q3']) expect([k, x.includes(cat[k])]).toEqual([k, true]); }
  });
  it('only the declared fields, in declared order, values as given (personal ones masked by the API and marked); nothing undeclared, no raw form', () => {
    const h = view();
    expect(h).toContain('data-kv-fields="3"');
    expect([...h.matchAll(/data-kv-form-field="(\w+)"/g)].map((m) => m[1])).toEqual(['crop_planned', 'land_acres', 'farmer_name']);
    expect(text(h)).toContain('Crop planned: groundnut'); expect(text(h)).toContain('Land (acres): 2.5');
    expect(text(h)).toContain('Name: ••••••ame (personal, hidden)');
    expect(h).not.toContain(UNDECLARED_SENTINEL); expect(visible(h)).not.toMatch(/village/i);
  });
  it('the version it was made under, the scheme link, sent and decided; the step list is said NOT shown', () => {
    const t = text(view());
    expect(t).toContain('This application was made under version 3 of the scheme. A published version is never changed.');
    expect(view()).toContain(`href="/schemes/${SCHEME_ID}"`);
    expect(t).toMatch(/Sent\s+2026-10-05 06:00 UTC\s+Decided\s+—/);
    expect(t).toContain('The list of each step is not shown in this console.');
  });
  it('the version declares no field → said in words; no field printed', () => {
    const h = view({ app: OPENED_UNDECLARED });
    expect(text(h)).toContain('Version 2 of this scheme declares no form field, so no field of this application is shown here.');
    expect(h).toContain('data-kv-fields="none"'); expect(h).not.toContain('data-kv-form-field');
  });
  it('Q1-A: no figure printed — the sentinel never; no rupee sign anywhere', () => {
    for (const [l, cat] of Object.entries(CATS)) {
      const h = view({ cat });
      expect([l, h.includes(String(MONEY_SENTINEL_2C)) || /₹|28,?800/.test(h)]).toEqual([l, false]);
      expect([l, FALSE_2C.test(visible(h))]).toEqual([l, false]);
    }
  });
});

describe('PC-56 GOV-2c · Q2-A — who is offered which step', () => {
  it('a head, nothing says they checked / made / helped make it: check, clarify, approve, reject', () => {
    expect(offers(view())).toEqual(['verify', 'clarify', 'approve', 'reject']);
    expect(view()).toContain(`href="/applications/${APP_1}?do=approve&amp;act=confirm"`);
  });
  it('Approve / Reject HIDDEN from the person who checked it, made it or helped make it', () => {
    for (const k of ['actorIsVerifier', 'actorIsApplicant', 'actorIsAssister'] as const) {
      const o = offers(view({ facts: { ...NONE, [k]: true } }));
      expect([k, o.includes('approve'), o.includes('reject')]).toEqual([k, false, false]);
    }
  });
  it('an officer: check and clarify only, and told a head decides; a reader: nothing, told so', () => {
    const o = view({ me: OFFICER_2C });
    expect(offers(o)).toEqual(['verify', 'clarify']); expect(text(o)).toContain('Approving and rejecting are done by a head of this authority.');
    const r = view({ me: READER_2C });
    expect(offers(r)).toEqual([]); expect(text(r)).toContain('Your role can read this application. Checking and deciding need a role that includes them.');
  });
  it('no facts (the read gives none today): offered, and the page says the API refuses by name', () => {
    const h = view({ facts: null });
    expect(offers(h)).toContain('approve');
    expect(text(h)).toContain('This page cannot tell who checked this application. If it was you, approving or rejecting it is refused by name and nothing changes.');
    expect(view()).not.toContain('data-kv-fact="cannot-tell"');
  });
  it('a decided application: no step open', () => {
    const h = view({ app: OPENED_DECIDED });
    expect(offers(h)).toEqual([]); expect(text(h)).toContain('No step is open to you on this application in its present status.');
  });
  it('the lone-head fact in words of fact', () => {
    expect(text(view({ decision: 'alone' }))).toContain('You are the only current member of this authority. A decision follows a check by another person, so no application can be decided here now.');
    expect(text(view({ decision: 'no_head', me: OFFICER_2C }))).toContain('This authority has no current head, so no application can be decided here now.');
    expect(view()).not.toContain('data-kv-decision-fact');
  });
  it('states: not found / off / forbidden / error (Retry → the re-read chain)', () => {
    expect(text(view({ state: 'not_found', app: null }))).toContain('This application was not found among the applications sent to your authority\'s schemes.');
    expect(text(view({ state: 'off', app: null }))).toContain('The government console is switched off on this platform.');
    expect(view({ state: 'error', app: null })).toContain(`href="/applications/${APP_1}?do=reread&amp;act=confirm" data-kv-retry=""`);
    expect(view({ state: 'error', app: null })).not.toContain('data-kv-offer');
  });
  it.each(Object.entries(CATS))('%s: every refusal of the page BY NAME', (_l, cat) => {
    const t = text(view({ cat }));
    for (const k of gov2RefusalKeys('application')) expect([k, t.includes(cat[k])]).toEqual([k, true]);
  });
});

describe('PC-56 GOV-2c · the act forms (W3159) and answers (W3160 / W3161)', () => {
  const f = (act: 'verify' | 'clarify' | 'approve' | 'reject', cat: Record<string, string> = en) => renderToStaticMarkup(<ActForm t={tr(cat)} appId={APP_1} act={act} idemKey="k-123" action={noop} />);
  it('reject: a listed reason (11, required) AND a sentence 10–500 (required)', () => {
    const h = f('reject');
    expect(h).toContain('data-kv-reasons="11"'); expect((h.match(/<option /g) ?? []).length).toBe(12);
    expect(h).toMatch(/<select[^>]*name="reasonCode"[^>]*required/); expect(h).toMatch(/<textarea[^>]*name="note"[^>]*minLength="10"[^>]*maxLength="500"[^>]*required/);
    expect(text(h)).toContain('The name differs on the land papers');
  });
  it('clarify: a sentence; verify and approve: no field but the id, the act and the key; approve repeats Q1-A', () => {
    expect(f('clarify')).toMatch(/<textarea[^>]*name="note"[^>]*required/); expect(f('clarify')).not.toContain('reasonCode');
    for (const a of ['verify', 'approve'] as const) {
      const names = [...f(a).matchAll(/name="(\w+)"/g)].map((m) => m[1]);
      expect([a, names]).toEqual([a, ['id', 'act', 'key']]);
    }
    expect(text(f('approve'))).toContain(Q1);
    expect(f('approve')).toContain('value="k-123"');
  });
  it('the answer: the status the API returned; the named refusal ×3, nothing changed', () => {
    expect(text(renderToStaticMarkup(<ActDoneNote t={tr(en)} status="approved" />))).toContain('The application is now: Approved.');
    for (const [l, cat] of Object.entries(CATS)) for (const code of ['GOV_DECIDER_IS_VERIFIER', 'GOV_DECIDER_IS_APPLICANT', 'GOV_DECIDER_IS_ASSISTER', 'GOV_NOT_VERIFIED']) {
      const h = renderToStaticMarkup(<ActFailureNote t={tr(cat)} error={code} />);
      expect([l, code, text(h).includes(cat[`gov2.err.${code}`]), h.includes(`data-kv-error="${code}"`)]).toEqual([l, code, true, true]);
    }
    expect(renderToStaticMarkup(<ActFailureNote t={tr(en)} error="WHATEVER" />)).toContain('data-kv-error="ACT_FAILED"');
  });
});
