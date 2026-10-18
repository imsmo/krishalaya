// apps/web-partner/src/test-render/account-api.render.test.tsx · PC-56 PARTNER-1b · founder D1 (canon W267, W2907–W2913) — API keys: the list
// with active / revoked / inactive rows (prefix, scopes, quota, last used, status + the administrator's reason) and NO hash; the truths;
// "Revoke" only for a person who may and only on a live key; the REVOKE chain — confirm (the Idempotency-Key a HIDDEN field minted at render,
// the reason typed there, at least 20) → success (revoked at <time>) → the named failure; switched off ("nothing is broken", never
// "unavailable"); not in your role; empty; the Create-key chain DECOR.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeysView } from '../components/partner1/KeysView';
import { RevokeConfirm, RevokeFailure, RevokeSuccess } from '../components/partner1/RevokeChain';
import { ChainNotice } from '../components/partner1/ChainNotice';
import { partner1RefusalKeys } from '../features/partner1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_1B, KEYS } from './partner1b-fixtures';

const IDEM = '11111111-2222-4333-8444-555555555555';
const MAIL = { kind: 'published' as const, address: 'ops@fixture.test' };
const view = (extra: Partial<Parameters<typeof KeysView>[0]> = {}) =>
  renderToStaticMarkup(<KeysView t={tr(en)} lang="en" state="ok" keys={KEYS} canRevoke mailbox={MAIL} {...extra} />);

describe('PC-56 PARTNER-1b · W267 API keys (render)', () => {
  it('the list: prefix, scopes, quota, last used, status (revoked with its reason) — and no hash, no secret', () => {
    const html = view(); const w = text(html);
    for (const k of KEYS) { expect(w).toContain(k.name); expect(w).toContain(k.keyPrefix); }
    expect(w).toContain('partner:identity:read'); expect(w).toContain('lending:book:read');
    expect(w).toContain('1000 requests an hour'); expect(w).toContain('Never');
    expect(w).toMatch(/Revoked on .*18.*2026/); expect(w).toContain('reason: the job was retired and its key is no longer needed');
    expect(w).toContain('Not active'); expect(w).toContain('Active');
    expect(html).not.toMatch(/key_?hash|keyHash|secret_enc|[0-9a-f]{64}/i);
    expect(w).toContain(en['partner1.keys.secretTruth']); expect(w).toContain(en['partner1.keys.revokeTruth']); expect(w).toContain(en['partner1.keys.apiSwitch']);
    for (const k of partner1RefusalKeys('keys')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).not.toMatch(FALSE_1B);
  });
  it('"Revoke" only on a live key and only for a person who may revoke; Create key is DECOR (to the form chain) with the mailbox fact', () => {
    const html = view();
    expect(html).toContain(`href="/account/api?act=revoke&amp;id=${KEYS[0].id}"`);
    expect(html).toContain(`href="/account/api?act=revoke&amp;id=${KEYS[2].id}"`);
    expect(html).not.toContain(`act=revoke&amp;id=${KEYS[1].id}`);
    expect(view({ canRevoke: false })).not.toContain('act=revoke');
    expect(html).toContain('href="/account/api?form=review"'); expect(text(html)).toContain(en['partner1.keys.createRefused']);
    expect(html).toContain('href="mailto:ops@fixture.test"');
    expect(text(view({ mailbox: { kind: 'none' } }))).toContain(en['partner1.ops.mailboxNone']);
  });
  it('states: switched off (never "unavailable"), not in your role, could not read, none issued yet', () => {
    const off = text(view({ state: 'off', keys: [] }));
    expect(off).toContain(en['partner.off.title']); expect(off).toContain('Nothing is broken'); expect(off).not.toMatch(/unavailable/i);
    expect(text(view({ state: 'forbidden', keys: [] }))).toContain(en['partner1.keys.forbidden']);
    expect(text(view({ state: 'error', keys: [] }))).toContain(en['partner1.keys.error']);
    expect(text(view({ keys: [] }))).toContain(en['partner1.keys.empty']);
    expect(view({ keys: [] })).toContain('data-kv-keys="empty"');
  });
  it('W2911 confirm: what happens, the reason field (at least 20), the Idempotency-Key as a HIDDEN field minted at render; a revoked key is not offered', () => {
    const html = renderToStaticMarkup(<RevokeConfirm t={tr(en)} keyRow={KEYS[0]} idempotencyKey={IDEM} action="/x" />);
    expect(html).toContain('data-kv-canon="W2911"');
    expect(html).toContain(`<input type="hidden" name="idempotencyKey" value="${IDEM}"/>`);
    expect(html).toContain(`<input type="hidden" name="id" value="${KEYS[0].id}"/>`);
    expect(html).toContain('name="reason"'); expect(html).toContain('minLength="20"'); expect(html).toContain('maxLength="300"');
    expect(text(html)).toContain(`${KEYS[0].name} (${KEYS[0].keyPrefix}) stops working at once`);
    expect(html).not.toMatch(/action="[^"]*reason=/);
    expect(renderToStaticMarkup(<RevokeConfirm t={tr(en)} keyRow={KEYS[1]} idempotencyKey={IDEM} action="/x" />)).toContain('data-kv-revoke-missing');
    expect(renderToStaticMarkup(<RevokeConfirm t={tr(en)} keyRow={null} idempotencyKey={IDEM} action="/x" />)).not.toContain('<form');
  });
  it('W2912 success: revoked at <time>, the prefix, the reason kept; W2913 failure: the named refusal, nothing changed, Retry → confirm', () => {
    const ok = text(renderToStaticMarkup(<RevokeSuccess t={tr(en)} lang="en" keyRow={KEYS[1]} />));
    expect(ok).toMatch(new RegExp(`${KEYS[1].keyPrefix} was revoked at .*2026`)); expect(ok).toContain(en['partner1.keys.success.trail']);
    for (const [code, key] of [['PARTNER_KEY_ALREADY_REVOKED', 'partner1.keys.err.PARTNER_KEY_ALREADY_REVOKED'], ['PARTNER_KEY_NOT_FOUND', 'partner1.keys.err.PARTNER_KEY_NOT_FOUND'],
      ['PARTNER_PERMISSION_MISSING', 'partner1.keys.err.PARTNER_PERMISSION_MISSING'], ['WHATEVER', 'partner1.keys.err.unknown']]) {
      const html = renderToStaticMarkup(<RevokeFailure t={tr(en)} id={KEYS[0].id} code={code} />);
      expect(html).toContain('data-kv-canon="W2913"'); expect(text(html)).toContain(en[key]); expect(text(html)).toContain(en['partner1.keys.failure.unchanged']);
      expect(html).toContain(`href="/account/api?act=revoke&amp;id=${KEYS[0].id}"`);
    }
    expect(text(renderToStaticMarkup(<RevokeFailure t={tr(en)} id={KEYS[0].id} code="PARTNER_KEY_REASON_REQUIRED" />))).toContain('Write a reason of 20 to 300 characters.');
  });
  it('the Create-key chain (W2907–W2910) is DECOR: its sentence and refusals, back to the page, no form; Hindi renders', () => {
    for (const s of ['error', 'review', 'success', 'failure']) {
      const html = renderToStaticMarkup(<ChainNotice t={tr(en)} chain="keys_form" state={s} />);
      expect(text(html)).toContain(en[`partner1.chain.keys.${s}.title`]); expect(html).toContain('href="/account/api"'); expect(html).not.toContain('<form');
    }
    expect(text(renderToStaticMarkup(<KeysView t={tr(hi)} lang="hi" state="ok" keys={KEYS} canRevoke mailbox={MAIL} />))).toContain(hi['partner1.keys.title']);
  });
});
