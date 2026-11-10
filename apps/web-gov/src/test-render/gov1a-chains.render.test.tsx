// apps/web-gov/src/test-render/gov1a-chains.render.test.tsx · PC-56 GOV-1a — the two chain groups GOV-1a builds:
//   the LOGIN chain (W3229–W3232, `?act=` on /login): form-error REAL (the form again), review DECOR, success REAL (the authority named),
//   failure REAL (the named refusal) — Back → /login ALWAYS (the canon's links to W325 are a defect);
//   the ACCESS chain (W3198–W3200, `?act=` on /access): REAL from "Request a role" / approve / remove (confirm = the form with a key minted;
//   success = what the SERVER did; failure = the refusal by name, nothing changed), PARITY-DECOR from the error state's Retry (the confirm
//   state's one link IS the re-read) — Back → /access. Every state prints its refusals BY NAME and never the canon's shared sentences.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov1Chain } from '../components/gov1/Gov1Chain';
import { AccessDoneNote, AccessFailureNote, ApproveConfirm, RemoveForm, RequestForm } from '../components/gov1/AccessViews';
import { LoginView, type LoginActions } from '../components/gov1/LoginViews';
import { ACCESS_ERRORS } from '../features/gov1/access';
import { GOV1_CHAINS, gov1RefusalKeys } from '../features/gov1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { FALSE_1A, ME_HEAD, ME_OFFICER, ROWS, text, tr, visible } from './gov1a-fixtures';

const act = async () => undefined;
const KEY = '0192d2c4-4e70-7000-8000-000000000001';
const ACTIONS: LoginActions = { requestOtp: act, verifyOtp: act, choose: act, twoFactor: act, enrol: act, confirmEnrol: act, startOver: act };
const login = (a: 'form-error' | 'review' | 'success' | 'failure', extra: Record<string, unknown> = {}, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<LoginView t={tr(cat)} step="verify" act={a} actions={ACTIONS} {...extra} />);
const access = (chain: 'access_act' | 'access_reread', s: string, child?: React.ReactNode, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<Gov1Chain t={tr(cat)} chain={chain} state={s}>{child}</Gov1Chain>);

describe('PC-56 GOV-1a · the login chain (W3229–W3232)', () => {
  it('every state links Back to /login — never the dashboard', () => {
    for (const s of ['form-error', 'review', 'success', 'failure'] as const) {
      const h = login(s, { error: 'OTP_WRONG', left: 1 });
      expect([s, h.includes('data-kv-back="/login"')]).toEqual([s, true]);
      expect([s, /data-kv-back="\/dashboard"/.test(h)]).toEqual([s, false]);
      expect(h).toContain(`data-kv-chain="login_form"`); expect(h).toContain(`data-kv-chain-state="${s}"`);
    }
  });
  it('form-error REAL: the refusal and the SAME form again (the code)', () => {
    const h = login('form-error', { error: 'OTP_WRONG', left: 1 });
    expect(h).toContain('data-kv-chain-kind="REAL"'); expect(h).toContain('data-kv-form="verify"');
    expect(text(h)).toContain('That code is wrong. Tries left on this code: 1.');
    const t2 = login('form-error', { error: 'TOTP_INVALID', step: '2fa' });
    expect(t2).toContain('data-kv-form="2fa"');
  });
  it('review DECOR: a sign-in has no review step', () => {
    const h = login('review');
    expect(h).toContain('data-kv-chain-kind="DECOR"'); expect(text(h)).toContain('A sign-in has no review step.'); expect(h).not.toContain('<form');
  });
  it('success REAL: the authority the API named; the console link; unknown → said plainly', () => {
    const h = login('success', { signedInTo: 'Test Authority One' });
    expect(text(h)).toContain('You are signed in to Test Authority One.'); expect(h).toContain('href="/dashboard" data-kv-real="console"');
    expect(text(login('success'))).toContain('You are signed in.');
  });
  it('failure REAL: the named refusal; no form', () => {
    const h = login('failure', { error: 'NOT_A_GOVERNMENT_ACCOUNT' });
    expect(text(h)).toContain('That session was not a government authority\'s, so it was closed.'); expect(h).not.toContain('data-kv-form');
  });
  it('every state: the chain refusals BY NAME, and none of the canon\'s shared sentences', () => {
    for (const s of ['form-error', 'review', 'success', 'failure'] as const) {
      const h = login(s, { error: 'OTP_EXPIRED' });
      for (const k of gov1RefusalKeys('login_form')) expect([s, k, text(h).includes(en[k])]).toEqual([s, k, true]);
      expect(FALSE_1A.test(visible(h))).toBe(false);
      expect(text(h)).not.toMatch(/reconcile|zero-sum|on-call|View audit trail/i);
    }
  });
});

describe('PC-56 GOV-1a · the access chain (W3198–W3200)', () => {
  it('confirm (request): phone, role, 1–12 months, a reason of 10–500; the key minted when shown; Back → /access', () => {
    const h = access('access_act', 'confirm', <RequestForm t={tr(en)} idemKey={KEY} action={act} />);
    expect(h).toContain('data-kv-chain="access_act" data-kv-chain-kind="REAL" data-kv-chain-state="confirm"');
    for (const f of ['phone', 'roleCode', 'termMonths', 'reason', 'key']) expect([f, h.includes(`name="${f}"`)]).toEqual([f, true]);
    expect(h).toContain(`name="key" value="${KEY}"`); expect(h).toMatch(/name="reason"[^>]*minLength="10"[^>]*maxLength="500"[^>]*required/);
    expect((h.match(/<option value="\d+"/g) ?? []).length).toBe(12);
    expect(h).toContain('<option value="authority_head">Head</option>'); expect(h).toContain('<option value="authority_officer">Officer</option>');
    expect(h).toContain('data-kv-back="/access"');
    expect(text(h)).toContain('The request waits until a head who did not ask for it, and who would not hold it, approves it.');
  });
  it('confirm (approve): offered to the second person only — the requester and the grantee see why not', () => {
    const ok = access('access_act', 'confirm', <ApproveConfirm t={tr(en)} row={ROWS[4]} rows={ROWS} me={ME_HEAD} idemKey={KEY} action={act} />);
    expect(ok).toContain('data-kv-form="approve"'); expect(ok).toContain('name="id" value="m5"'); expect(text(ok)).toContain('Approve, as the second person');
    for (const row of [ROWS[3], ROWS[5]]) {
      const no = access('access_act', 'confirm', <ApproveConfirm t={tr(en)} row={row} rows={ROWS} me={ME_HEAD} idemKey={KEY} action={act} />);
      expect(no).toContain('data-kv-not-offered="approve"'); expect(no).not.toContain('<form');
    }
    expect(access('access_act', 'confirm', <ApproveConfirm t={tr(en)} row={ROWS[4]} rows={ROWS} me={ME_OFFICER} idemKey={KEY} action={act} />)).toContain('data-kv-not-offered="approve"');
  });
  it('confirm (remove): a head, a reason, at once; never their own row; an officer never', () => {
    const ok = access('access_act', 'confirm', <RemoveForm t={tr(en)} row={ROWS[2]} rows={ROWS} me={ME_HEAD} idemKey={KEY} action={act} />);
    expect(ok).toContain('data-kv-form="remove"'); expect(ok).toMatch(/name="reason"[^>]*minLength="10"[^>]*required/);
    expect(text(ok)).toContain('This takes effect at once and is recorded with your reason.');
    expect(access('access_act', 'confirm', <RemoveForm t={tr(en)} row={ROWS[0]} rows={ROWS} me={ME_HEAD} idemKey={KEY} action={act} />)).toContain('data-kv-not-offered="remove"');
    expect(access('access_act', 'confirm', <RemoveForm t={tr(en)} row={ROWS[2]} rows={ROWS} me={ME_OFFICER} idemKey={KEY} action={act} />)).toContain('data-kv-not-offered="remove"');
  });
  it('success: what the SERVER did — requested (waiting for a second person), approved (its end), removed (sessions ended)', () => {
    expect(text(access('access_act', 'success', <AccessDoneNote t={tr(en)} done="requested" />))).toContain('Requested — waiting for a second person: a head who did not ask for it and would not hold it.');
    expect(text(access('access_act', 'success', <AccessDoneNote t={tr(en)} done="approved" expiresAt="2027-11-10T06:30:00.000Z" />))).toContain('Approved. The role ends 2027-11-10 06:30 UTC.');
    expect(text(access('access_act', 'success', <AccessDoneNote t={tr(en)} done="removed" sessionsEnded={2} />))).toContain('Removed, at once. Sessions ended: 2.');
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s failure: every named refusal prints its own sentence; nothing changed', (_l, cat) => {
    for (const [code, key] of Object.entries(ACCESS_ERRORS)) {
      const h = access('access_act', 'failure', <AccessFailureNote t={tr(cat)} error={code} />, cat);
      expect([code, h.includes(`data-kv-error="${code}"`)]).toEqual([code, true]);
      expect([code, text(h).includes(cat[key])]).toEqual([code, true]);
      expect(text(h)).toContain(cat['gov1.access.nothingChanged']);
    }
  });
  it('the Retry chain is PARITY-DECOR: the confirm state\'s one link IS the re-read; it writes nothing; Back → /access', () => {
    const h = access('access_reread', 'confirm');
    expect(h).toContain('data-kv-chain-kind="PARITY-DECOR"'); expect(h).toContain('href="/access" data-kv-real="reread"');
    expect(text(h)).toContain('Reading the list again writes nothing.'); expect(h).toContain('data-kv-back="/access"'); expect(h).not.toContain('<form');
  });
  it('the registry\'s 1a chains are exactly these three, and each state renders its own title and body in en/hi/gu', () => {
    const ONE_A = GOV1_CHAINS.filter((c) => c.wave === '1a');
    expect(ONE_A.map((c) => c.id)).toEqual(['login_form', 'access_act', 'access_reread']);
    for (const cat of [en, hi, gu]) for (const c of ONE_A) for (const s of c.states) {
      for (const part of ['title', 'body']) expect([c.id, s, part, typeof cat[`${c.key(s)}.${part}`]]).toEqual([c.id, s, part, 'string']);
    }
  });
});
