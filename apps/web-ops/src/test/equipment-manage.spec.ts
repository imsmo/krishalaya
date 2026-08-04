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
