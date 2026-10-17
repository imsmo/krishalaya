// apps/web-partner/src/test-render/login.render.test.tsx · PC-56 PARTNER-0 · F-9 / D8 — the sign-in TO THE PARTNER, rendered: the verify step
// carries the phone NOWHERE but masked text (no link, action, hidden field or query string holds it); the chooser lists the person's partner
// organisations by name with no token in the markup; the switched-off state prints the sentence, not a form. Renders the SAME component the
// page renders (components/LoginSteps.tsx) — the page only reads cookies / the flag and passes them in.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginSteps, loginErrorKey } from '../components/LoginSteps';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';

const tr = (cat: Record<string, string>) => ({ t: (key: string, vars: Record<string, string | number> = {}) => (cat[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (_m, n) => (n in vars ? String(vars[n]) : `{${n}}`)) });
const actions = { requestOtp: '/x/otp', verifyOtp: '/x/verify', choose: '/x/choose', twoFactor: '/x/2fa', startOver: '/x/again' };
const PHONE = '+919812345318';

describe('PC-56 PARTNER-0 · the partner sign-in markup', () => {
  it('the phone step asks for the phone (a form field, posted — never a link)', () => {
    const html = renderToStaticMarkup(<LoginSteps t={tr(en)} step="phone" actions={actions} />);
    expect(html).toContain('name="phone"');
    expect(html).not.toMatch(/href="[^"]*phone=/);
  });
  it('the verify step: the phone appears ONLY masked — no full number, no `phone=` anywhere, no hidden phone field', () => {
    const html = renderToStaticMarkup(<LoginSteps t={tr(en)} step="verify" phoneMasked="••••••318" actions={actions} />);
    expect(html).toContain('••••••318');
    expect(html).not.toContain(PHONE);
    expect(html).not.toContain('9812345318');
    expect(html).not.toMatch(/phone=/);
    expect(html).not.toMatch(/name="phone"/);
    expect(html).toContain('name="code"');
    expect(html).toMatch(/action="\/x\/verify"/);
  });
  it('the chooser lists the partner organisations by name, one radio each, and carries no choice token', () => {
    const html = renderToStaticMarkup(<LoginSteps t={tr(en)} step="choose" choices={[{ id: 'p-a', name: 'Bank A' }, { id: 'p-b', name: 'Bank B' }]} actions={actions} />);
    expect(html).toContain(en['partner.login.chooseTitle']);
    expect((html.match(/type="radio" name="partnerId"/g) ?? []).length).toBe(2);
    expect(html).toContain('value="p-a"'); expect(html).toContain('Bank B');
    expect(html).not.toMatch(/choiceToken|choice_token|name="token"/);
  });
  it('the second-factor step asks a 6-digit code; the switched-off state prints the sentence and no form', () => {
    expect(renderToStaticMarkup(<LoginSteps t={tr(en)} step="2fa" actions={actions} />)).toContain('pattern="[0-9]{6}"');
    const off = renderToStaticMarkup(<LoginSteps t={tr(en)} step="off" actions={actions} />);
    expect(off).toContain(en['partner.off.title']); expect(off).not.toContain('<form');
  });
  it('errors are named codes → sentences (NOT_A_PARTNER, no access, an expired choice); Hindi falls back to en for an untranslated key', () => {
    expect(loginErrorKey('NOT_A_PARTNER')).toBe('partner.login.notAPartner');
    expect(loginErrorKey('PARTNER_ACCESS_NONE')).toBe('partner.login.noAccess');
    expect(loginErrorKey('OTP_INVALID')).toBe('login.failed');
    expect(loginErrorKey(null)).toBeNull();
    const html = renderToStaticMarkup(<LoginSteps t={tr(hi)} step="phone" error="NOT_A_PARTNER" actions={actions} />);
    expect(html).toContain(hi['partner.login.notAPartner']);
    expect(html).toContain(en['login.sendOtp']);   // an existing key: not translated in this wave → en
  });
});
