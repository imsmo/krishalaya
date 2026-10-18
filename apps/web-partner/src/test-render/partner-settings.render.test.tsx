// apps/web-partner/src/test-render/partner-settings.render.test.tsx · PC-56 PARTNER-1a · founder D5 (canon W269, W3002–W3008) — organisation
// settings: the identity (masked regulator reference, code, kind "(fixed)"); the published promise with its actuals or "not published yet";
// the team rows with NO mail address and no "last active"; the invite chain confirm (the Idempotency-Key minted at render, a hidden field) →
// success (the code ONCE, "send it yourself; we never email a secret") → failure (a named refusal; no seat limit); Save changes DECOR with its
// refusal; the roles truth (one person may hold more than one role) and "application reads are logged".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsView, ActConfirm } from '../components/partner1/SettingsView';
import { InviteChainView } from '../components/partner1/InviteChain';
import { partner1RefusalKeys } from '../features/partner1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { FIGURES, ME, TEAM, text, tr } from './partner1a-fixtures';

const labels = (cat: Record<string, string>) => Object.fromEntries(Object.keys(en).filter((k) => k.startsWith('partner1.invite.') || k.startsWith('partner1.role.')).map((k) => [k, cat[k] ?? en[k]]));
const KEY = '11111111-2222-4333-8444-555555555555';
const view = (step: 'edit' | 'confirm' | 'success' | 'failure', extra: Partial<Parameters<typeof InviteChainView>[0]> = {}) =>
  renderToStaticMarkup(<InviteChainView labels={labels(en)} lang="en" step={step} idempotencyKey={KEY} phone="+919812345678" roleCode="partner_checker" result={null} code={null} {...extra} />);

describe('PC-56 PARTNER-1a · W269 organisation settings (render)', () => {
  it('identity, the promise with its actuals, the team (no mail address), invites, the truths, Save changes DECOR, the refusals', () => {
    const html = renderToStaticMarkup(<SettingsView t={tr(en)} lang="en" me={ME} sla={FIGURES.sla} team={{ kind: 'ok', team: TEAM }} invite={null} />);
    const w = text(html);
    for (const s of ['Fixture Lending Partner', 'bank', '(fixed)', '••••4471', 'fixture_bank']) expect(w).toContain(s);
    expect(w).toContain('Published promise: a decision within 48 hours');
    expect(w).toContain('median 31.0 hours');
    expect(w).toContain(en['partner1.settings.slaWho']);
    expect(w).toContain('Fixture Administrator'); expect(w).toContain('Fixture Checker'); expect(w).not.toContain('Removed Person');
    expect(w).toContain('Administrator'); expect(w).toContain('Checker — decides what is under review');
    expect(w).toContain('Enrolled'); expect(w).toContain('Not enrolled');
    expect(html).toContain('href="/account/settings?act=remove_member&amp;id=m-2"');
    expect(html).toContain('href="/account/settings?act=revoke_invite&amp;id=i-1"');
    expect(html).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\./);         // no mail address anywhere
    expect(html).not.toMatch(/<th[^>]*>(Last active|Security|Email)/); expect(w).not.toMatch(/FIDO2/);
    expect(w).toContain(en['partner1.settings.rolesTruth']); expect(w).toContain(en['partner1.settings.logged']);
    expect(html).toContain('href="/account/settings?form=review"'); expect(w).toContain(en['partner1.settings.saveRefused']);
    for (const k of partner1RefusalKeys('settings')) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('no promise published → "not published yet"; a non-admin sees that the team is shown to administrators; Hindi renders', () => {
    const me = { ...ME, organisation: { ...ME.organisation!, sla: {}, slaDecisionHours: null } };
    const w = text(renderToStaticMarkup(<SettingsView t={tr(en)} lang="en" me={me} sla={null} team={{ kind: 'admins_only' }} invite={null} />));
    expect(w).toContain(en['partner1.dash.slaNone']); expect(w).toContain(en['partner1.settings.teamAdminsOnly']);
    const h = text(renderToStaticMarkup(<SettingsView t={tr(hi)} lang="hi" me={me} sla={null} team={{ kind: 'admins_only' }} invite={null} />));
    expect(h).toContain(hi['partner1.settings.title']);
  });
  it('W3006 confirm: the masked phone and the role, the Idempotency-Key as a HIDDEN field minted at render; the full phone nowhere', () => {
    const html = view('confirm');
    expect(html).toContain('data-kv-canon="W3006"');
    expect(html).toContain(`<input type="hidden" name="idempotencyKey" value="${KEY}"/>`);
    expect(html).toContain('••••••678'); expect(html).not.toContain('9812345678');
    expect(text(html)).toContain('Checker — decides what is under review');
  });
  it('W3007 success: the code shown ONCE with "send it yourself; we never email a secret"; a replay shows no code', () => {
    const html = view('success', { result: { token: 'A'.repeat(43), expiresAt: '2026-10-25T06:30:00.000Z', phoneMasked: '••••••678', roleCode: 'partner_checker' } });
    expect(html).toContain('data-kv-canon="W3007"');
    expect(html).toContain(`data-kv-token="once">${'A'.repeat(43)}</code>`);
    expect(text(html)).toMatch(/send it yourself to ••••••678; we never email a secret/);
    const replay = view('success', { result: { token: null, expiresAt: '2026-10-25T06:30:00.000Z', phoneMasked: '••••••678', roleCode: 'partner_checker' } });
    expect(replay).toContain('data-kv-token="replayed"'); expect(replay).not.toContain('data-kv-token="once"');
  });
  it('W3008 failure: the named refusal (already a member / pending / rate limit / phone), nothing changed; no seat limit for partners', () => {
    for (const [code, key] of [['PARTNER_ALREADY_MEMBER', 'partner1.invite.err.PARTNER_ALREADY_MEMBER'], ['PARTNER_INVITE_PENDING_EXISTS', 'partner1.invite.err.PARTNER_INVITE_PENDING_EXISTS'],
      ['RATE_LIMITED', 'partner1.invite.err.RATE_LIMITED'], ['SOMETHING_ELSE', 'partner1.invite.err.unknown']]) {
      const html = view('failure', { code });
      expect(html).toContain('data-kv-canon="W3008"'); expect(text(html)).toContain(en['partner1.invite.failure.title']); expect(text(html)).toContain(en[key]);
    }
    expect(text(view('edit'))).toContain(en['partner1.invite.seats']);
    expect(view('edit')).toContain('name="phone"');
  });
  it('revoke / remove: their own confirm with a reason of at least the API\'s minimum, posting the id; a missing subject says so', () => {
    const html = renderToStaticMarkup(<ActConfirm t={tr(en)} act="remove_member" id="m-2" subject={{ name: 'Fixture Checker', role: 'partner_checker' }} action="/x" />);
    expect(html).toContain('name="reason"'); expect(html).toContain('minLength="10"'); expect(html).toContain('value="m-2"');
    expect(text(html)).toContain('Fixture Checker (Checker — decides what is under review) loses access');
    expect(renderToStaticMarkup(<ActConfirm t={tr(en)} act="revoke_invite" id="x" subject={null} action="/x" />)).toContain('data-kv-act-missing');
  });
});
