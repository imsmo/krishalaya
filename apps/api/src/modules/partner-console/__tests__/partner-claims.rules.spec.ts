// modules/partner-console/__tests__/partner-claims.rules.spec.ts · PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS — the pure pieces: the
// claim projection strips EVERY identity field for a poisoned row and for 200 generated rows (M3 kills here: a `claimantUserId` passed through);
// `waitingDays`; the FY window's boundaries in Asia/Kolkata (and its SQL twin); the counts merge (statuses of the machine, the eight platform
// event codes + not recorded, decided counts — never a rate).
import { CLAIM_STATUSES } from '../../insurance/domain/insurance-claim.state';
import {
  CLAIM_IDENTITY_FIELDS, FY_WINDOW_SQL, fyLabel, fyWindow, isOpenClaim, mergeClaimCounts, NOT_RECORDED, PARTNER_CLAIM_STATUSES, projectClaim, validWindow, waitingDays,
} from '../domain/partner-claims.rules';

const PERSON = '0192d2c4-dead-7000-8000-00000000beef';
const NOTE = 'Kesar Ben said the vet came late; phone +91 94000 00229';
const COMPUTED = '2026-10-20T06:30:00.000Z';
const ALLOWED = new Set(['id', 'policyId', 'policyNo', 'productId', 'productName', 'fpoName', 'subjectType', 'sumInsuredMinor', 'eventTypeCode', 'eventDate', 'status',
  'reportedWithin72h', 'approvedMinor', 'damagePercent', 'filedAt', 'lastChangedAt', 'closedAt', 'waitingDays']);
/** A row carrying EVERY identity column (snake and camel), as if a definer had been widened — none may reach the view. */
const poisoned = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '0192d2c4-0001-7000-8000-000000000001', tenant_id: '0192d2c4-7777-7000-8000-000000000007', policy_id: '0192d2c4-0002-7000-8000-000000000002',
  product_id: '0192d2c4-0003-7000-8000-000000000003', policy_no: null, subject_type: 'animal', sum_insured_minor: '11000000', event_type_code: 'death',
  event_date: '2026-10-10', status: 'surveyed', intimated_within_72h: false, approved_minor: null, damage_percent: 62,
  created_at: '2026-10-11T04:00:00.000Z', created_us: '2026-10-11T04:00:00.123456Z', updated_at: '2026-10-15T04:00:00.000Z', closed_at: null,
  claimant_user_id: PERSON, claimantUserId: PERSON, description: NOTE, surveyor_user_id: PERSON, surveyorUserId: PERSON,
  survey_report: { damagePercent: 62, notes: NOTE }, surveyReport: { notes: NOTE }, notes: NOTE, note: NOTE, payout_id: PERSON, payoutId: PERSON,
  created_by: PERSON, createdBy: PERSON, updated_by: PERSON, updatedBy: PERSON, tenantId: PERSON, phone: '+919400000229', name: 'Kesar Ben V.',
  holder_user_id: PERSON, subject_id: PERSON, media: [PERSON], evidence: 3, vetCertRef: 'VET-1', village: 'Bilkha', parcel: PERSON,
  ...over,
});
const deepKeys = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
};

describe('PC-56 PARTNER-3a · projectClaim — claim facts, never a claimant (founder Q4)', () => {
  it('a POISONED row (every identity column present) projects to the allow-list only — no identity key, no identity value', () => {
    const v = projectClaim(poisoned(), { fpoName: 'Fixture Dairy Collective', productName: 'Fixture cattle cover' }, COMPUTED);
    expect(Object.keys(v).filter((k) => !ALLOWED.has(k))).toEqual([]);
    expect(deepKeys(v).filter((k) => (CLAIM_IDENTITY_FIELDS as readonly string[]).includes(k))).toEqual([]);
    const json = JSON.stringify(v);
    for (const needle of [PERSON, 'Kesar', '+91', 'Bilkha', 'VET-1', 'vet came late', '0192d2c4-7777']) expect([needle, json.includes(needle)]).toEqual([needle, false]);
    expect(v).toEqual({
      id: '0192d2c4-0001-7000-8000-000000000001', policyId: '0192d2c4-0002-7000-8000-000000000002', policyNo: null, productId: '0192d2c4-0003-7000-8000-000000000003',
      productName: 'Fixture cattle cover', fpoName: 'Fixture Dairy Collective', subjectType: 'animal', sumInsuredMinor: '11000000', eventTypeCode: 'death',
      eventDate: '2026-10-10', status: 'surveyed', reportedWithin72h: false, approvedMinor: null, damagePercent: 62, filedAt: '2026-10-11T04:00:00.123456Z',
      lastChangedAt: '2026-10-15T04:00:00.000Z', closedAt: null, waitingDays: 9,
    });
  });
  it('200 generated rows (random statuses, amounts past 2^53, missing fields): never an identity key or value; money stays a string', () => {
    let seed = 11;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 200; i++) {
      const row = poisoned({ status: CLAIM_STATUSES[Math.floor(rnd() * CLAIM_STATUSES.length)], approved_minor: rnd() < 0.5 ? null : '9007199254740993',
        damage_percent: rnd() < 0.3 ? null : rnd() < 0.5 ? 150 : Math.floor(rnd() * 101), event_type_code: rnd() < 0.2 ? null : 'flood' });
      if (rnd() < 0.5) delete row.policy_no;
      const v = projectClaim(row, { fpoName: null, productName: null }, COMPUTED);
      expect(Object.keys(v).filter((k) => !ALLOWED.has(k))).toEqual([]);
      expect(JSON.stringify(v).includes(PERSON)).toBe(false);
      if (v.approvedMinor !== null) expect(v.approvedMinor).toBe('9007199254740993');
      expect(v.damagePercent === null || (Number.isInteger(v.damagePercent) && v.damagePercent <= 100)).toBe(true);
    }
  });
  it('an unresolved event type prints as not recorded (null), a non-boolean 72h as unknown (null), a malformed amount as null — never invented', () => {
    const v = projectClaim(poisoned({ event_type_code: null, intimated_within_72h: null, approved_minor: '12.5', damage_percent: 62.5 }), { fpoName: null, productName: null }, COMPUTED);
    expect([v.eventTypeCode, v.reportedWithin72h, v.approvedMinor, v.damagePercent]).toEqual([null, null, null, null]);
  });
});

describe('PC-56 PARTNER-3a · waitingDays — whole days since filing, for an open claim only', () => {
  it('counts whole days to computedAt; null once rejected / paid / closed; never negative', () => {
    expect(waitingDays('2026-10-11T04:00:00.000Z', COMPUTED, 'intimated')).toBe(9);
    expect(waitingDays('2026-10-20T06:29:59.000Z', COMPUTED, 'docs_pending')).toBe(0);
    expect(waitingDays('2026-10-21T00:00:00.000Z', COMPUTED, 'surveyed')).toBe(0);
    expect(waitingDays('2026-10-11T04:00:00.000Z', COMPUTED, 'approved')).toBe(9);   // approved is still waiting: nothing pays it (founder Q1)
    for (const s of ['rejected', 'paid', 'closed']) expect([s, waitingDays('2026-10-11T04:00:00.000Z', COMPUTED, s)]).toEqual([s, null]);
    expect([waitingDays(null, COMPUTED, 'intimated'), waitingDays('2026-10-11T04:00:00.000Z', COMPUTED, 'lapsing')]).toEqual([null, null]);
    expect([isOpenClaim('partially_approved'), isOpenClaim('paid'), PARTNER_CLAIM_STATUSES.length]).toEqual([true, false, 9]);
  });
});

describe('PC-56 PARTNER-3a · the FY window — April to March in Asia/Kolkata', () => {
  it('the boundaries fall at IST midnight, not UTC: 31 Mar 18:29:59Z is still the old FY; 31 Mar 18:30:00Z is 1 Apr IST — the new FY', () => {
    expect(fyWindow(new Date('2027-03-31T18:29:59.999Z'))).toEqual({ from: '2026-04-01', to: '2027-04-01', label: '2026-27' });
    expect(fyWindow(new Date('2027-03-31T18:30:00.000Z'))).toEqual({ from: '2027-04-01', to: '2028-04-01', label: '2027-28' });
    expect(fyWindow(new Date('2026-10-20T06:30:00.000Z'))).toEqual({ from: '2026-04-01', to: '2027-04-01', label: '2026-27' });
    expect(fyWindow(new Date('2026-01-15T00:00:00.000Z')).label).toBe('2025-26');
  });
  it('a window is labelled an FY only when it IS one; validWindow takes two real days, from < to, at most 400 days', () => {
    expect([fyLabel('2026-04-01', '2027-04-01'), fyLabel('2026-04-01', '2026-10-01'), fyLabel('2026-05-01', '2027-05-01')]).toEqual(['2026-27', null, null]);
    expect(validWindow('2026-04-01', '2027-04-01')).toBe(true);
    for (const [a, b] of [['2026-04-01', '2026-04-01'], ['2027-04-01', '2026-04-01'], ['2026-02-30', '2026-04-01'], ['2026-04-01', '2028-04-01'], ['20260401', '2027-04-01']]) {
      expect([a, b, validWindow(a, b)]).toEqual([a, b, false]);
    }
  });
  it('the database answers the same rule: the SQL reads now() in Asia/Kolkata and starts the FY in April', () => {
    expect(FY_WINDOW_SQL).toMatch(/now\(\) AT TIME ZONE 'Asia\/Kolkata'/);
    expect(FY_WINDOW_SQL).toMatch(/extract\(month FROM today\) >= 4/);
    expect(FY_WINDOW_SQL).toMatch(/make_date\(y, 4, 1\)/); expect(FY_WINDOW_SQL).toMatch(/make_date\(y \+ 1, 4, 1\)/);
  });
});

describe('PC-56 PARTNER-3a · mergeClaimCounts — counts add over the shards; decided COUNTS, never a rate', () => {
  it('every status of the machine present; the platform event codes + not recorded; an unresolvable code counts as not recorded', () => {
    const c = mergeClaimCounts([
      { product_id: 'a', status: 'intimated', event_type_code: 'flood', n: '2' },
      { product_id: 'a', status: 'approved', event_type_code: 'death', n: '1' },
      { product_id: 'b', status: 'partially_approved', event_type_code: null, n: 3 },
      { product_id: 'a', status: 'rejected', event_type_code: 'Kesar Ben', n: '1' },
      { product_id: 'a', status: 'intimated', event_type_code: 'flood', n: '4' },   // a second shard's row for the same key
      { product_id: 'a', status: 'paid', event_type_code: 'hail', n: '-1' },          // nonsense is dropped, never subtracted
    ], { from: '2026-04-01', to: '2027-04-01' }, COMPUTED);
    expect(c).toEqual({
      from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27', total: 11,
      byStatus: { intimated: 6, docs_pending: 0, survey_scheduled: 0, surveyed: 0, approved: 1, partially_approved: 3, rejected: 1, paid: 0, closed: 0 },
      byEvent: { [NOT_RECORDED]: 4, flood: 6, death: 1 },
      decided: { approved: 1, partiallyApproved: 3, rejected: 1 }, computedAt: COMPUTED,
    });
    expect(JSON.stringify(c)).not.toMatch(/ratio|rate|median|percent|Minor/i);
  });
});
