import { canQuote, canStart, canComplete, canSettle, canCancelRental, buildQuoteAdvance, buildStartOtp, buildActualQuantity, isRentalStatus } from '../features/equipment/manage';

describe('features/equipment/manage (OW-3)', () => {
  it('gates mirror the rental state machine', () => {
    expect(canQuote('requested')).toBe(true); expect(canQuote('quoted')).toBe(false);
    expect(canStart('confirmed')).toBe(true); expect(canStart('quoted')).toBe(false);
    expect(canComplete('in_progress')).toBe(true); expect(canComplete('confirmed')).toBe(false);
    expect(canSettle('completed')).toBe(true); expect(canSettle('settled')).toBe(false);
    expect(canCancelRental('requested')).toBe(true); expect(canCancelRental('quoted')).toBe(true);
    expect(canCancelRental('in_progress')).toBe(false);
    expect(isRentalStatus('settled')).toBe(true); expect(isRentalStatus('x')).toBe(false);
  });
  it('builders: float-free advance (0 allowed = no advance), 4–12-digit OTP, positive qty ≤3dp', () => {
    expect(buildQuoteAdvance('250.50')).toEqual({ ok: true, value: '25050' });
    expect(buildQuoteAdvance('0')).toEqual({ ok: true, value: '0' });
    expect(buildQuoteAdvance('abc')).toEqual({ ok: false, error: 'advance' });
    expect(buildStartOtp(' 4321 ')).toEqual({ ok: true, value: '4321' });
    expect(buildStartOtp('12')).toEqual({ ok: false, error: 'otp' });
    expect(buildActualQuantity('3.5')).toEqual({ ok: true, value: '3.5' });
    expect(buildActualQuantity('0')).toEqual({ ok: false, error: 'quantity' });
  });
});

// PC-56 HOTFIX-13 (founder Q1-A, 2026-11-09): the settle refusal SETTLE_HOURS_NOT_CONFIRMED is shown BY NAME on /equipment/[id]
// (until OPS-4a removes the owner's money buttons from this console), in all three languages.
describe('HOTFIX-13 · settle refused until the renter confirms the hours — by name', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('the action maps the code to its own error key, and the page admits that key', () => {
    expect(src('app/equipment/actions.ts')).toMatch(/e\.code === 'SETTLE_HOURS_NOT_CONFIRMED' \? 'hoursNotConfirmed'/);
    expect(src('app/equipment/[id]/page.tsx')).toMatch(/new Set\(\[[^\]]*'hoursNotConfirmed'[^\]]*\]\)/);
  });
  it('chc.error.hoursNotConfirmed exists ×3; the English is the fact the refusal proves, then the founder\'s sentence', async () => {
    const [en, hi, gu] = await Promise.all(['en', 'hi', 'gu'].map(async (l) => (await import(`../i18n/${l}`)) as Record<string, unknown>));
    const dict = (m: Record<string, unknown>) => (m.default ?? Object.values(m).find((v) => v && typeof v === 'object')) as Record<string, string>;
    for (const m of [en, hi, gu]) expect(typeof dict(m)['chc.error.hoursNotConfirmed']).toBe('string');
    expect(dict(en)['chc.error.hoursNotConfirmed']).toBe("Not settled: the renter has not confirmed these hours in her own app. Nothing beyond the deposit leaves the renter's wallet until she confirms those hours in her own app.");
  });
});
