// modules/insurance/__tests__/insurance-policy.entity.spec.ts · aggregate invariants + event emission.
import { InsurancePolicy } from '../domain/insurance-policy.entity';
import { InsuranceEventType } from '../domain/insurance.events';
import { InvalidSumInsuredError, InvalidPolicyValidityError } from '../domain/insurance.errors';
import { IllegalPolicyTransitionError } from '../domain/insurance-policy.state';

const base = {
  id: 'p1', tenantId: 't1', holderUserId: 'u1', productId: 'pr1', policyNo: null,
  subjectType: 'crop_season' as const, subjectId: 'plot1',
  sumInsuredMinor: 100_000_00n, premiumMinor: 2_000_00n, premiumPaymentId: null,
  validFrom: '2026-06-15', validUntil: '2026-11-30', parametricTriggers: null,
};

describe('InsurancePolicy.propose', () => {
  it('always starts proposed + emits PolicyProposed (screen 283: "starts as proposed")', () => {
    const p = InsurancePolicy.propose(base);
    expect(p.status).toBe('proposed');
    const events = p.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(InsuranceEventType.PolicyProposed);
    expect((events[0].payload as any).premiumMinor).toBe('200000');
  });
  it('rejects zero/negative sum insured', () => {
    expect(() => InsurancePolicy.propose({ ...base, sumInsuredMinor: 0n })).toThrow(InvalidSumInsuredError);
    expect(() => InsurancePolicy.propose({ ...base, sumInsuredMinor: -1n })).toThrow(InvalidSumInsuredError);
  });
  it('rejects validUntil <= validFrom', () => {
    expect(() => InsurancePolicy.propose({ ...base, validFrom: '2026-11-30', validUntil: '2026-06-15' })).toThrow(InvalidPolicyValidityError);
    expect(() => InsurancePolicy.propose({ ...base, validFrom: '2026-06-15', validUntil: '2026-06-15' })).toThrow(InvalidPolicyValidityError);
  });
});

describe('InsurancePolicy.cancel', () => {
  it('proposed→cancelled emits PolicyCancelled', () => {
    const p = InsurancePolicy.propose(base); p.pullEvents();
    p.cancel();
    expect(p.status).toBe('cancelled');
    const events = p.pullEvents();
    expect(events.map((e) => e.type)).toContain(InsuranceEventType.PolicyCancelled);
  });
  it('cannot cancel an already-cancelled policy (terminal)', () => {
    const p = InsurancePolicy.propose(base); p.pullEvents();
    p.cancel();
    expect(() => p.cancel()).toThrow(IllegalPolicyTransitionError);
  });
  it('rehydrated active policy CAN still be cancelled (surrender path)', () => {
    const p = InsurancePolicy.rehydrate({ ...base, status: 'active' });
    p.cancel();
    expect(p.status).toBe('cancelled');
  });
  it('rehydrated claimed policy CANNOT be cancelled (terminal)', () => {
    const p = InsurancePolicy.rehydrate({ ...base, status: 'claimed' });
    expect(() => p.cancel()).toThrow(IllegalPolicyTransitionError);
  });
});

describe('InsurancePolicy.activate (DEV-23, KV-BL-053)', () => {
  it('proposed->active sets premiumPaymentId + emits PolicyActivated', () => {
    const p = InsurancePolicy.propose(base); p.pullEvents();
    const changed = p.activate('pay-1');
    expect(changed).toBe(true);
    expect(p.status).toBe('active');
    expect(p.toProps().premiumPaymentId).toBe('pay-1');
    expect(p.pullEvents().map((e) => e.type)).toContain(InsuranceEventType.PolicyActivated);
  });
  it('is idempotent: a repeat activation is a no-op (returns false), never throws', () => {
    const p = InsurancePolicy.rehydrate({ ...base, status: 'active', premiumPaymentId: 'pay-1' });
    expect(p.activate('pay-2')).toBe(false);
    expect(p.toProps().premiumPaymentId).toBe('pay-1'); // unchanged — never overwritten by a replay
  });
  it('cannot activate a cancelled (terminal) policy', () => {
    const p = InsurancePolicy.rehydrate({ ...base, status: 'cancelled' });
    expect(() => p.activate('pay-3')).toThrow(IllegalPolicyTransitionError);
  });
});

describe('InsurancePolicy.markClaimed (DEV-23, KV-BL-054)', () => {
  it('active->claimed emits PolicyClaimed', () => {
    const p = InsurancePolicy.rehydrate({ ...base, status: 'active' });
    p.markClaimed();
    expect(p.status).toBe('claimed');
    expect(p.pullEvents().map((e) => e.type)).toContain(InsuranceEventType.PolicyClaimed);
  });
  it('cannot mark a proposed (not yet on-cover) policy claimed', () => {
    const p = InsurancePolicy.propose(base);
    expect(() => p.markClaimed()).toThrow(IllegalPolicyTransitionError);
  });
  it('claimed is terminal — cannot be claimed twice', () => {
    const p = InsurancePolicy.rehydrate({ ...base, status: 'claimed' });
    expect(() => p.markClaimed()).toThrow(IllegalPolicyTransitionError);
  });
});

describe('toJSON — money rendered as strings, no float', () => {
  it('serialises bigint fields as decimal strings', () => {
    const p = InsurancePolicy.propose(base);
    const json = p.toJSON();
    expect(json.sumInsuredMinor).toBe('10000000');
    expect(json.premiumMinor).toBe('200000');
    expect(typeof json.sumInsuredMinor).toBe('string');
  });
});
