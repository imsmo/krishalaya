// modules/partner-console/__tests__/partner-insurance.rules.spec.ts · PC-56 PARTNER-2a · founder Q6 — the projections STRIP identity BY
// CONSTRUCTION (for ANY input row — even one a widened definer handed over, mutant M4), the in-force rule, the bigint sums, the shard merge.
import { formulaOf, IDENTITY_FIELDS, inForce, isPartnerPolicyStatus, ISSUANCE_STATUS, mergeCounts, PARTNER_POLICY_STATUSES, projectPolicy, projectProduct, projectQueueRow, sumMinor } from '../domain/partner-insurance.rules';

function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const FORBIDDEN = new Set<string>(IDENTITY_FIELDS);

/** A row carrying EVERY column of insurance_policies (0011) and then some — snake and camel. */
const POISONED: Record<string, unknown> = {
  id: '0192d2c4-aaaa-7000-8000-000000000001', tenant_id: 'aaaaaaaa-0000-7000-8000-000000000001', tenantId: 'aaaaaaaa-0000-7000-8000-000000000001',
  holder_user_id: 'bbbbbbbb-0000-7000-8000-000000000002', holderUserId: 'bbbbbbbb-0000-7000-8000-000000000002', holder: { name: 'A person', phone: '+910000000000' },
  product_id: 'cccccccc-0000-7000-8000-000000000003', policy_no: null, subject_type: 'animal', subject_id: 'dddddddd-0000-7000-8000-000000000004',
  subjectId: 'dddddddd-0000-7000-8000-000000000004', sum_insured_minor: '16000000', premium_minor: '512000', premium_payment_id: 'eeeeeeee-0000-7000-8000-000000000005',
  premiumPaymentId: 'eeeeeeee-0000-7000-8000-000000000005', status: 'active', valid_from: '2026-07-12', valid_until: '2027-07-12',
  parametric_triggers: { index: 'rain' }, created_by: 'bbbbbbbb-0000-7000-8000-000000000002', updated_by: 'x', created_at: '2026-07-12T05:00:00.000Z',
  created_us: '2026-07-12T05:00:00.123456Z', name: 'A person', phone: '+910000000000', ear_tag: '8102', health: 'vaccinated',
};

describe('PC-56 PARTNER-2a · the insurer read — projections strip identity for ANY input', () => {
  it('a policy: only the policy facts; no holder, subject, payment, tenant, name or phone property — and none of their values', () => {
    const v = projectPolicy(POISONED, { fpoName: 'Fixture Growers Collective', productName: 'Fixture cattle cover' });
    expect(deepKeys(v).filter((k) => FORBIDDEN.has(k))).toEqual([]);
    expect(Object.keys(v).sort()).toEqual(['createdAt', 'fpoName', 'id', 'policyNo', 'premiumMinor', 'productId', 'productName', 'status', 'subjectType', 'sumInsuredMinor', 'validFrom', 'validUntil']);
    const json = JSON.stringify(v);
    for (const leaked of ['bbbbbbbb', 'dddddddd', 'eeeeeeee', 'aaaaaaaa', '+910000000000', 'A person', '8102', 'vaccinated', 'rain']) expect([leaked, json.includes(leaked)]).toEqual([leaked, false]);
    expect(v).toMatchObject({ policyNo: null, subjectType: 'animal', sumInsuredMinor: '16000000', premiumMinor: '512000', validFrom: '2026-07-12', validUntil: '2027-07-12', createdAt: '2026-07-12T05:00:00.123456Z', fpoName: 'Fixture Growers Collective' });
  });
  it('a policy: money stays a bigint string past 2^53; a `date` read as a JS Date keeps its calendar day', () => {
    const v = projectPolicy({ ...POISONED, sum_insured_minor: '9007199254740993', valid_from: new Date(2026, 6, 12) }, { fpoName: null, productName: null });
    expect(v.sumInsuredMinor).toBe('9007199254740993');
    expect(v.validFrom).toBe('2026-07-12');
  });
  it('for many generated rows, no identity field ever survives', () => {
    for (let i = 0; i < 200; i++) {
      const row: Record<string, unknown> = { ...POISONED };
      for (const f of IDENTITY_FIELDS) row[f] = i % 2 ? `v-${i}` : { nested: { [f]: i } };
      const v = projectPolicy(row, { fpoName: i % 3 ? 'x' : null, productName: null });
      expect(deepKeys(v).filter((k) => FORBIDDEN.has(k))).toEqual([]);
    }
  });
  it('a product: the insurer\'s own terms as data, the formula typed; no identity property; subsidy and commission as integer bps', () => {
    const p = projectProduct({ id: 'p1', name: 'Fixture crop cover', kind_id: null, kind_code: null, premium_calc: { kind: 'pct_of_sum_insured', bps: 200 },
      sum_insured_rules: {}, govt_subsidy_bps: 4000, our_commission_bps: 250, is_parametric: false, is_active: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
      partner_id: 'pp', holder_user_id: 'never', tenant_id: 'never' }, { active: 1, proposed: 1 });
    expect(deepKeys(p).filter((k) => FORBIDDEN.has(k))).toEqual([]);
    expect(p).toMatchObject({ productName: 'Fixture crop cover', kind: { id: null, code: null }, formula: { kind: 'pct_of_sum_insured', bps: 200 }, govtSubsidyBps: 4000, ourCommissionBps: 250, active: true, policies: { active: 1, proposed: 1 } });
    expect(JSON.stringify(p)).not.toContain('never');
    expect(Object.keys(p)).not.toContain('partnerId');
  });
  it('a formula enrolment cannot price (a float percentage, parametric terms) is `not_priceable` — never a guessed rate', () => {
    expect(formulaOf({ pct_of_sum_insured: 2.0 })).toEqual({ kind: 'not_priceable' });
    expect(formulaOf({ parametric: { index: 'rain' } })).toEqual({ kind: 'not_priceable' });
    expect(formulaOf({ kind: 'flat_minor', amountMinor: '48000' })).toEqual({ kind: 'flat_minor', amountMinor: '48000' });
  });
});

describe('PC-56 PARTNER-2a · in force, the statuses, the sums, the shard merge', () => {
  it('in force = active only (proposed awaits the farmer\'s payment — founder Q5)', () => {
    expect(PARTNER_POLICY_STATUSES.filter(inForce)).toEqual(['active']);
    expect(inForce('proposed')).toBe(false); expect(inForce('cancelled')).toBe(false);
  });
  it('the status filter is the state machine\'s own list', () => {
    expect([...PARTNER_POLICY_STATUSES]).toEqual(['proposed', 'active', 'lapsed', 'cancelled', 'expired', 'claimed']);
    expect(isPartnerPolicyStatus('active')).toBe(true); expect(isPartnerPolicyStatus('lapsing')).toBe(false); expect(isPartnerPolicyStatus(undefined)).toBe(false);
  });
  it('sumMinor adds bigint strings exactly (past 2^53)', () => {
    expect(sumMinor(['9007199254740993', '7', null, undefined, ''])).toBe('9007199254741000');
  });
  it('mergeCounts: counts and bigint sums add over shards; per-product status counts add', () => {
    const m = mergeCounts([
      { policies: '3', inForce: '1', inForceSumInsuredMinor: '9007199254740993', proposed: '1', fpos: '2', perProduct: { p1: { active: 1, proposed: 1, cancelled: 1 } } },
      { policies: '2', inForce: '1', inForceSumInsuredMinor: '7', proposed: '0', fpos: '1', perProduct: { p1: { active: 1 }, p2: { proposed: 1 } } },
    ]);
    expect(m).toEqual({ policies: 5, inForce: { count: 2, sumInsuredMinor: '9007199254741000' }, proposed: 1, fpos: 3, perProduct: { p1: { active: 2, proposed: 1, cancelled: 1 }, p2: { proposed: 1 } } });
    expect(mergeCounts([])).toEqual({ policies: 0, inForce: { count: 0, sumInsuredMinor: '0' }, proposed: 0, fpos: 0, perProduct: {} });
  });
});

describe('PC-56 PARTNER-2b · the issuance queue row (founder Q5) — a READ of proposals, identity stripped by construction', () => {
  it('the queue is `proposed` by construction — never in force', () => {
    expect(ISSUANCE_STATUS).toBe('proposed');
    expect(inForce(ISSUANCE_STATUS)).toBe(false);
  });
  it('a queue row: the allow-list only — no holder, subject, payment, tenant, name, phone, policy number or status; none of their values (M4)', () => {
    const v = projectQueueRow({ ...POISONED, status: 'proposed' }, { fpoName: 'Fixture Growers Collective', productName: 'Fixture cattle cover' });
    expect(deepKeys(v).filter((k) => FORBIDDEN.has(k))).toEqual([]);
    expect(Object.keys(v).sort()).toEqual(['fpoName', 'id', 'premiumMinor', 'productId', 'productName', 'proposedAt', 'subjectType', 'sumInsuredMinor', 'validFrom', 'validUntil']);
    const json = JSON.stringify(v);
    for (const leaked of ['bbbbbbbb', 'dddddddd', 'eeeeeeee', 'aaaaaaaa', '+910000000000', 'A person', '8102', 'vaccinated', 'rain']) expect([leaked, json.includes(leaked)]).toEqual([leaked, false]);
    expect(v).toMatchObject({ subjectType: 'animal', sumInsuredMinor: '16000000', premiumMinor: '512000', proposedAt: '2026-07-12T05:00:00.123456Z', validFrom: '2026-07-12', validUntil: '2027-07-12' });
  });
  it('for many generated rows, no identity field ever survives a queue row; money stays a bigint string', () => {
    for (let i = 0; i < 200; i++) {
      const row: Record<string, unknown> = { ...POISONED, premium_minor: '9007199254740993' };
      for (const f of IDENTITY_FIELDS) row[f] = i % 2 ? `v-${i}` : { nested: { [f]: i } };
      const v = projectQueueRow(row, { fpoName: i % 3 ? 'x' : null, productName: null });
      expect(deepKeys(v).filter((k) => FORBIDDEN.has(k))).toEqual([]);
      expect(v.premiumMinor).toBe('9007199254740993');
    }
  });
});
