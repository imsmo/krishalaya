// apps/web-gov/src/test-render/gov-access.render.test.tsx · PC-56 GOV-1a — W359 (`/access`): the authority's people AS GOV-0 GIVES THEM (the
// name, or the phone by its last 3; role; who asked and who approved — resolved only from the same list, the platform's appointment said so;
// when it ends, labelled UTC; status), Q4-A verbatim with the first-head fact beside it; APPROVE offered only to a head who is neither the
// requester nor the grantee; REMOVE offered only to a head, never on their own row; the lone-head and no-head facts; no request or removal
// reason printed; the refusals BY NAME; the forbidden, switched-off and error states (Retry = a re-read).
// PC-56 GOV-4b (W356, Q4-A): the "Sign-ins" section — Q4's sentence exact, the lock without "never locked", the download sentence, the
// refusals BY NAME; no sign-in list, address, device or colleague's sign-in — even when a SENTINEL fixture carries them (×3 languages).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessView } from '../components/gov1/AccessViews';
import { gov1RefusalKeys } from '../features/gov1/refusals';
import { gov4RefusalKeys } from '../features/gov4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { FALSE_1A, ME_HEAD, ME_HEAD2, ME_OFFICER, ROWS, ROWS_LONE, ROWS_NO_HEAD, rowOf, text, tr, visible } from './gov1a-fixtures';

const Q4 = 'Every role here ends on its date. A role is granted only when a second person approves it — never by the person asking. Anyone who grants roles can remove one at once; every change is recorded.';
const view = (me: typeof ME_HEAD, rows = ROWS, cat: Record<string, string> = en, state: 'ok' | 'forbidden' | 'error' | 'off' = 'ok') =>
  renderToStaticMarkup(<AccessView t={tr(cat)} state={state} me={me} rows={rows} />);

describe('PC-56 GOV-1a · W359 /access — the people as the API gives them', () => {
  it('Q4-A verbatim, and beside it the fact that the platform appoints the first head', () => {
    const h = view(ME_HEAD);
    expect(text(h)).toContain(Q4); expect(h).toContain('data-kv-statement="gov1.access.q4"');
    expect(text(h)).toContain('An authority\'s first head is appointed by the platform.');
  });
  it('every row: the name (or the phone by its last 3), role, asked by, approved by, ends (UTC), status — resolved from the same list', () => {
    const h = view(ME_HEAD);
    expect(h).toContain('data-kv-people="8"');
    const r1 = text(rowOf(h, 'm1'));
    expect(r1).toContain('Test Head One (you)'); expect(r1).toContain('Head'); expect(r1).toContain('The platform'); expect(r1).toContain('2027-11-01 05:00 UTC'); expect(r1).toContain('Active');
    const r2 = text(rowOf(h, 'm2'));
    expect(r2).toContain('Test Officer One'); expect(r2).toContain('You'); expect(r2).toContain('2027-05-02 05:00 UTC');
    const r4 = text(rowOf(h, 'm4'));
    expect(r4).toContain('••••••104'); expect(r4).toContain('4 months after approval'); expect(r4).toContain('Waiting for a second person');
    expect(text(rowOf(h, 'm7'))).toContain('Ended on its date');
    expect(text(rowOf(h, 'm8'))).toContain('Removed 2026-11-05 05:00 UTC');
    expect(text(h)).not.toContain('a reason of ten characters'); expect(text(h)).not.toContain('a removal reason here');
  });
  it('APPROVE is offered ONLY to a head who neither asked for it nor would hold it', () => {
    const h = view(ME_HEAD);
    expect(rowOf(h, 'm5')).toContain('data-kv-offer="approve"');          // asked for by the officer, for someone else → offered
    expect(rowOf(h, 'm4')).not.toContain('data-kv-offer="approve"');      // asked for by the viewer → never
    expect(rowOf(h, 'm6')).not.toContain('data-kv-offer="approve"');      // for the viewer → never
    expect((h.match(/data-kv-offer="approve"/g) ?? []).length).toBe(1);
    const h2 = view(ME_HEAD2);                                              // the second head may approve the first head's request
    expect(rowOf(h2, 'm4')).toContain('data-kv-offer="approve"'); expect(rowOf(h2, 'm6')).toContain('data-kv-offer="approve"');
    expect(view(ME_OFFICER)).not.toContain('data-kv-offer="approve"');    // an officer approves nothing
  });
  it('REMOVE is offered ONLY to a head, never on their own row, never on a removed one; a pending request is withdrawn', () => {
    const h = view(ME_HEAD);
    for (const id of ['m2', 'm3', 'm4', 'm5', 'm7']) expect([id, rowOf(h, id).includes('data-kv-offer="remove"')]).toEqual([id, true]);
    for (const id of ['m1', 'm6', 'm8']) expect([id, rowOf(h, id).includes('data-kv-offer="remove"')]).toEqual([id, false]);
    expect(text(rowOf(h, 'm4'))).toContain('Withdraw the request');
    expect(view(ME_OFFICER)).not.toContain('data-kv-offer="remove"');
  });
  it('"Request a role" is REAL for every member (both roles hold the request permission)', () => {
    for (const me of [ME_HEAD, ME_OFFICER]) expect(view(me)).toContain('href="/access?act=confirm&amp;do=request" data-kv-real="request"');
  });
  it('the lone head: "No one else here can approve a request yet." — a fact, never a workaround; no live head: said so; two heads: nothing', () => {
    const lone = view(ME_HEAD, ROWS_LONE);
    expect(lone).toContain('data-kv-approver-fact="only_you"'); expect(text(lone)).toContain('No one else here can approve a request yet.');
    expect(rowOf(lone, 'm4')).not.toContain('data-kv-offer="approve"');
    const none = view(ME_OFFICER, ROWS_NO_HEAD);
    expect(none).toContain('data-kv-approver-fact="none"'); expect(text(none)).toContain('No one here can approve a request now: there is no current head.');
    expect(view(ME_HEAD)).not.toContain('data-kv-approver-fact');
    expect(view(ME_OFFICER, ROWS_LONE)).not.toContain('data-kv-approver-fact');   // an officer with one head: someone else CAN approve
  });
  it('the refusals BY NAME; no false canon word outside them; no farmer, no roster of an organisation, no money', () => {
    const h = view(ME_HEAD);
    for (const k of gov1RefusalKeys('access')) expect([k, text(h).includes(en[k])]).toEqual([k, true]);
    expect(FALSE_1A.test(visible(h))).toBe(false);
    expect(visible(h)).not.toMatch(/₹|farmer|member roster|payout|%/i);
  });
  it('states: forbidden, switched off, error with Retry = a re-read; no people listed', () => {
    const f = view(ME_OFFICER, [], en, 'forbidden'); expect(f).toContain('data-kv-notice="forbidden"'); expect(f).not.toContain('data-kv-people');
    expect(view(ME_HEAD, [], en, 'off')).toContain('data-kv-notice="off"');
    const e = view(ME_HEAD, [], en, 'error');
    expect(text(e)).toContain('Only this page failed to load. Nothing was changed.'); expect(e).toContain('href="/access?act=confirm&amp;do=reread" data-kv-retry=""');
    expect(text(view(ME_HEAD, []))).toContain('No one holds or has asked for a role here.');
  });
  it.each([['hi', hi], ['gu', gu]] as const)('%s: the same skeleton, the catalogue\'s Q4 sentence, every key resolved', (_l, cat) => {
    const h = view(ME_HEAD, ROWS, cat);
    expect(text(h)).toContain(cat['gov1.access.q4']);
    expect(/gov1\.|common\./.test(text(h))).toBe(false);
    expect((h.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|')).toBe((view(ME_HEAD).match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|'));
  });
});

const Q4B = 'Each sign-in to this console is recorded by the platform. This console does not list sign-ins, and it never shows where anyone signed in from.';
/** The SENTINEL: what Q4-A says this console never shows — sign-in rows, addresses, devices, a colleague's attempts — loaded into every prop. */
const SIG = { ip: '203.0.113.77', ip6: '2001:db8::77', device: 'Sentinel-Phone-Model-X', ua: 'SentinelAgent/9.1', fp: 'fp-sentinel-4411', city: 'Sentinelpur', when: '2026-11-09T04:41:00.000Z', who: 'Sentinel Colleague' };
const SIG_STRINGS = Object.values(SIG);
const signIn = { at: SIG.when, ip: SIG.ip, ipAddress: SIG.ip6, device: SIG.device, userAgent: SIG.ua, fingerprint: SIG.fp, location: SIG.city, succeeded: false, who: SIG.who };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadedMe = (me: typeof ME_HEAD): any => ({ ...me, lastSignIn: signIn, signIns: [signIn], sessions: [signIn], person: { ...me.person, lastSignIn: signIn, device: SIG.device, ip: SIG.ip } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadedRows = (): any[] => ROWS.map((m) => ({ ...m, lastSignIn: signIn, signIns: [signIn], ip: SIG.ip, device: SIG.device, location: SIG.city }));
const signinsOf = (h: string) => (h.match(/<section class="kv-card" data-kv-signins=""[\s\S]*?<\/section>\s*<\/section>/) ?? [''])[0];

describe('PC-56 GOV-4b · W356 — the "Sign-ins" section of /access', () => {
  it('Q4-A exact, once; the lock as the code proves it; the download sentence; heading "Sign-ins"; in every state', () => {
    for (const st of ['ok', 'forbidden', 'error', 'off'] as const) {
      const h = view(ME_HEAD, st === 'ok' ? ROWS : [], en, st); const t = text(h);
      expect([st, t.split(Q4B).length - 1]).toEqual([st, 1]);
      expect(h).toContain('data-kv-signins=""'); expect(h).toContain('data-kv-statement="gov4.q4"');
      expect(t).toContain('After too many wrong codes, no code is taken for a while; the sign-in page says how many minutes to wait.');
      expect(t).toContain('Sign-ins cannot be downloaded from this console.');
      expect(t).toContain('Sign-ins');
    }
  });
  it('never "never locked"; no sign-in list, table, count, link, form or button inside the section; no digit in it', () => {
    const sec = signinsOf(view(ME_HEAD));
    expect(sec.length).toBeGreaterThan(100);
    expect(sec).not.toMatch(/<table|<tr|<td|<form|<input|<button|<select|<a |<img|<ol|<time/i);
    expect(/\d/.test(text(sec))).toBe(false);
    expect(text(view(ME_HEAD))).not.toMatch(/never locked/i);
    expect(visible(view(ME_HEAD))).not.toMatch(/\bIP\b|SSO|hardware key|security key|step-up|regulator|RTI|export|throttl|append-only|watching the watchers|who got in|access events|out-of-state|security desk/i);
  });
  it('the refusals BY NAME (en): no rows, no device or address, no one sees sign-ins, one way in, wrong codes unlinked, same wait, reads not listed, no file', () => {
    const t = text(view(ME_HEAD));
    for (const k of gov4RefusalKeys('access_signins')) expect([k, t.includes(en[k])]).toEqual([k, true]);
    expect(gov4RefusalKeys('access_signins')).toHaveLength(8);
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the SENTINEL (sign-in rows, addresses, devices, a colleague\'s attempts) never reaches the markup', (_l, cat) => {
    for (const h of [view(loadedMe(ME_HEAD), loadedRows(), cat), view(loadedMe(ME_OFFICER), loadedRows(), cat), view(loadedMe(ME_HEAD), [], cat, 'error')]) {
      for (const s of SIG_STRINGS) expect([s, h.includes(s)]).toEqual([s, false]);
      expect(h).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|[0-9a-f]{1,4}::[0-9a-f]{1,4}/i);   // no address-shaped string
      expect(text(h)).toContain(cat['gov4.q4']);
      for (const k of gov4RefusalKeys('access_signins')) expect([k, text(h).includes(cat[k])]).toEqual([k, true]);
      expect(/gov4\.|gov1\.|common\./.test(text(h))).toBe(false);
    }
  });
});
