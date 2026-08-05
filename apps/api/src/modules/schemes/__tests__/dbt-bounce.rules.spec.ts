// PC-55 A3 · bounce rules + the PFMS port's honesty contract. A bounce is a farmer's missing money: these
// gates exist so the record stays truthful rather than tidy.
import { canResolve, reasonNoteRequired, resolutionNoteRequired, recreditRefRequired, bounceDateSane, isRecreditableWithoutDataFix, BOUNCE_REASON_CODES } from '../domain/dbt-bounce.rules';
import { NoopPfmsProvider, pfmsProviderFromEnv } from '../providers/pfms.provider';

describe('bounce resolution gates', () => {
  it('closes only from open, and exactly once', () => {
    expect(canResolve('open', 'recredited')).toBe(true);
    expect(canResolve('open', 'abandoned')).toBe(true);
    expect(canResolve('recredited', 'abandoned')).toBe(false);
    expect(canResolve('abandoned', 'recredited')).toBe(false);
  });
  it('demands evidence: recredit names a transfer, abandon carries a written reason', () => {
    expect(recreditRefRequired('recredited')).toBe(true);
    expect(recreditRefRequired('abandoned')).toBe(false);
    expect(resolutionNoteRequired('abandoned')).toBe(true);
    expect(resolutionNoteRequired('recredited')).toBe(false);
  });
  it("requires the bank's own words when the reason is 'other'", () => {
    expect(reasonNoteRequired('other')).toBe(true);
    expect(reasonNoteRequired('account_closed')).toBe(false);
  });
  it('keeps the real NPCI/PFMS return-reason families (no invented codes)', () => {
    expect(BOUNCE_REASON_CODES).toContain('aadhaar_not_seeded');
    expect(BOUNCE_REASON_CODES).toContain('name_mismatch');
    expect(BOUNCE_REASON_CODES).toContain('beneficiary_deceased');
    expect(BOUNCE_REASON_CODES).toHaveLength(10);
  });
});

describe('bounceDateSane (a bank statement is history, never a prophecy)', () => {
  it('rejects pre-credit and future dates, accepts same-day returns', () => {
    expect(bounceDateSane('2026-08-05', '2026-08-01T00:00:00.000Z', '2026-08-10')).toBe(true);
    expect(bounceDateSane('2026-08-01', '2026-08-01T00:00:00.000Z', '2026-08-10')).toBe(true);   // same-day bounce is real
    expect(bounceDateSane('2026-07-31', '2026-08-01T00:00:00.000Z', '2026-08-10')).toBe(false);  // before the credit
    expect(bounceDateSane('2026-08-11', '2026-08-01T00:00:00.000Z', '2026-08-10')).toBe(false);  // in the future
    expect(bounceDateSane('05-08-2026', '2026-08-01T00:00:00.000Z', '2026-08-10')).toBe(false);  // wrong format
  });
});

describe('desk triage', () => {
  it('separates retryable rails from reasons needing beneficiary data fixed first', () => {
    expect(isRecreditableWithoutDataFix('bank_rejected')).toBe(true);
    expect(isRecreditableWithoutDataFix('npci_mandate_absent')).toBe(true);
    expect(isRecreditableWithoutDataFix('aadhaar_not_seeded')).toBe(false);   // fix seeding first
    expect(isRecreditableWithoutDataFix('invalid_account')).toBe(false);
    expect(isRecreditableWithoutDataFix('beneficiary_deceased')).toBe(false); // never silently retried
  });
});

describe('PFMS port (Rule Zero: wired now, never faking)', () => {
  it('the noop provider refuses to claim availability and says why, out loud', async () => {
    const p = new NoopPfmsProvider();
    const r = await p.fetchRecon({ schemeId: 's1', from: '2026-07-01', to: '2026-08-01' });
    expect(p.name).toBe('noop');
    expect(r.providerAvailable).toBe(false);
    expect(r.records).toHaveLength(0);              // an empty pull is NEVER dressed up as a clean recon
    expect(r.note.toLowerCase()).toContain('pending');
  });
  it('env selection fails CLOSED — unknown/absent value gives the noop, never a silent fake', () => {
    expect(pfmsProviderFromEnv({}).name).toBe('noop');
    expect(pfmsProviderFromEnv({ PFMS_PROVIDER: 'noop' }).name).toBe('noop');
    expect(pfmsProviderFromEnv({ PFMS_PROVIDER: 'totally-made-up' }).name).toBe('noop');
  });
});
