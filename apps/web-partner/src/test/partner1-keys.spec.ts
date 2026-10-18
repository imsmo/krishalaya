// apps/web-partner/src/test/partner1-keys.spec.ts · PC-56 PARTNER-1b · founder D1 / D2 — the keys and webhooks pages' pure pieces: the revoke
// reason rule, the revoke chain's state from the query (the reason is never read from a URL), the named refusals, the status words; the
// deliveries query (unknown filters dropped), the detail id, the filter links, the state words from the rail's vocabulary.
import { keyReasonOk, keyStatusText, revokeErrorKey, revokeState, REVOKE_STEP_FILES } from '../features/partner1/keys';
import { deliveriesHref, deliveriesQuery, deliveryParam, deliveryStateKey, isDeliveryState, kib } from '../features/partner1/webhooks';
import { en } from '../i18n/en';

const tr = { t: (k: string, v: Record<string, string | number> = {}) => (en[k] ?? k).replace(/\{(\w+)\}/g, (_m, n) => String(v[n] ?? `{${n}}`)) };
const ID = '0192d2c4-1111-7000-8000-000000000001';

describe('PC-56 PARTNER-1b · keys (pure)', () => {
  it('the reason: 20–300 characters once whitespace is collapsed', () => {
    expect(keyReasonOk('x'.repeat(19))).toBe(false); expect(keyReasonOk('x'.repeat(20))).toBe(true);
    expect(keyReasonOk('x'.repeat(300))).toBe(true); expect(keyReasonOk('x'.repeat(301))).toBe(false);
    expect(keyReasonOk(`  ${'a  '.repeat(9)}  `)).toBe(false); expect(keyReasonOk(null)).toBe(false);
  });
  it('the revoke chain from the query: confirm / success / failure with a code; anything else is the page; the reason is never read', () => {
    expect(revokeState({ act: 'revoke', id: ID })).toEqual({ id: ID, step: 'confirm', code: null });
    expect(revokeState({ act: 'revoke', id: ID, state: 'success' })).toEqual({ id: ID, step: 'success', code: null });
    expect(revokeState({ act: 'revoke', id: ID, state: 'failure', code: 'PARTNER_KEY_ALREADY_REVOKED' })).toEqual({ id: ID, step: 'failure', code: 'PARTNER_KEY_ALREADY_REVOKED' });
    expect(revokeState({ act: 'revoke', id: ID, state: 'failure', code: '<script>' })).toEqual({ id: ID, step: 'failure', code: 'unknown' });
    expect(revokeState({ act: 'revoke', id: 'not-an-id' })).toBeNull();
    expect(revokeState({ act: 'remove_member', id: ID })).toBeNull();
    expect(revokeState(undefined)).toBeNull();
    expect(JSON.stringify(revokeState({ act: 'revoke', id: ID, reason: 'should never be read from a URL' }))).not.toContain('should never');
    expect(REVOKE_STEP_FILES).toEqual({ confirm: 'W2911', success: 'W2912', failure: 'W2913' });
  });
  it('the named refusals → their sentences; anything else → "could not be revoked"', () => {
    for (const c of ['PARTNER_KEY_NOT_FOUND', 'PARTNER_KEY_ALREADY_REVOKED', 'PARTNER_KEY_REASON_REQUIRED', 'PARTNER_PERMISSION_MISSING', 'PARTNER_IDEMPOTENCY_KEY_REQUIRED', 'RATE_LIMITED']) {
      expect(revokeErrorKey(c)).toBe(`partner1.keys.err.${c}`); expect(typeof en[revokeErrorKey(c)]).toBe('string');
    }
    expect(revokeErrorKey('SOMETHING')).toBe('partner1.keys.err.unknown'); expect(revokeErrorKey(null)).toBe('partner1.keys.err.unknown');
    expect(en['partner1.keys.err.PARTNER_KEY_NOT_FOUND']).not.toMatch(/another|not yours/i);
  });
  it('the status words: active / not active / revoked on <date> (India time)', () => {
    expect(keyStatusText(tr, { status: 'active', revokedAt: null }, 'en')).toBe('Active');
    expect(keyStatusText(tr, { status: 'inactive', revokedAt: null }, 'en')).toBe('Not active');
    expect(keyStatusText(tr, { status: 'revoked', revokedAt: '2026-10-18T06:30:00.000Z' }, 'en')).toMatch(/^Revoked on .*18.*2026.*12:00/);
    expect(keyStatusText(tr, { status: 'revoked', revokedAt: null }, 'en')).toBe('Revoked');
  });
});

describe('PC-56 PARTNER-1b · webhooks (pure)', () => {
  it('the deliveries query keeps only known filters; the detail id is a uuid or nothing', () => {
    expect(deliveriesQuery({ state: 'exhausted', endpoint: ID, cursor: 'MjAyNi0xMC0xOFQwMDowMDowMC4wMDAwMDBafA' })).toEqual({ state: 'exhausted', endpointId: ID, cursor: 'MjAyNi0xMC0xOFQwMDowMDowMC4wMDAwMDBafA' });
    expect(deliveriesQuery({ state: 'parked', endpoint: 'x', cursor: '<' })).toEqual({});
    expect(deliveriesQuery(undefined)).toEqual({});
    expect(deliveryParam({ delivery: ID })).toBe(ID); expect(deliveryParam({ delivery: '../x' })).toBeNull();
  });
  it('the filter links keep the other filter and reset the cursor', () => {
    expect(deliveriesHref({ state: 'held', endpointId: ID }, { state: 'delivered' })).toBe(`/account/webhooks?state=delivered&endpoint=${ID}#deliveries`);
    expect(deliveriesHref({ state: 'held' }, { state: null })).toBe('/account/webhooks#deliveries');
    expect(deliveriesHref({}, { cursor: 'abc' })).toBe('/account/webhooks?cursor=abc#deliveries');
  });
  it('the state words come from the rail\'s vocabulary; the response cap in KiB is integer arithmetic', () => {
    for (const s of ['pending', 'retrying', 'delivered', 'held', 'exhausted', 'cancelled']) { expect(isDeliveryState(s)).toBe(true); expect(typeof en[deliveryStateKey(s)]).toBe('string'); }
    expect(deliveryStateKey('parked')).toBe('partner1.hooks.state.unknown');
    expect(kib(65536)).toBe('64'); expect(kib(1000)).toBe('0');
  });
});
