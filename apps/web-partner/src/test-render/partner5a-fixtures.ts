// apps/web-partner/src/test-render/partner5a-fixtures.ts · PC-56 PARTNER-5a · THE BOOK IN ARREARS, AS COUNTS — the render tests' shared
// fixtures: the dpd read as this platform actually answers it (every servicing loan in `no_due_date`, the four rows behind a due date at
// zero, the servicing outstanding EQUAL to the six-bucket sum and past Number.MAX_SAFE_INTEGER), a mixed book for the other branches, a
// counts read with a restructured count above zero, and written-off loans as LOAN FACTS. Neutral figures only; no person, bank, place,
// account tail, loan or case number, scheme or avatar.
//
// SMUGGLED: the written-off loans also carry fields the view must NEVER print — a write-off reason, a borrower's name, who wrote it off and
// when. The SDK type has none of them; they are added here so the render test can prove the view prints ONLY the named loan facts, whatever
// a response might one day carry. These strings are invented and neutral by design — none is a canon phrase.
import type { PartnerBookArrears, PartnerBookCounts, PartnerBookLoan } from '@krishalaya/sdk-js';

const B = (count: number, outstandingMinor: string) => ({ count, outstandingMinor });

/** TODAY'S TRUTH: four servicing loans, none with a due date; Σ six buckets = servicing outstanding = 9007199254740993 (past 2^53). */
export const DPD: PartnerBookArrears = {
  buckets: {
    no_due_date: B(4, '9007199254740993'), not_due: B(0, '0'),
    '1-30': B(0, '0'), '31-60': B(0, '0'), '61-90': B(0, '0'), '90+': B(0, '0'),
  },
  arrears: B(0, '0'), noDueDate: B(4, '9007199254740993'), servicing: B(4, '9007199254740993'),
  noScheduleOnPlatform: true, computedAt: '2026-11-04T06:30:00.000Z',
};
/** A platform with due dates: every row non-zero, the sum still equal to the servicing total. */
export const DPD_MIXED: PartnerBookArrears = {
  buckets: {
    no_due_date: B(3, '300000'), not_due: B(5, '1500000'),
    '1-30': B(2, '480000'), '31-60': B(1, '120000'), '61-90': B(1, '60000'), '90+': B(1, '240000'),
  },
  arrears: B(5, '900000'), noDueDate: B(3, '300000'), servicing: B(13, '2700000'),
  noScheduleOnPlatform: false, computedAt: '2026-11-04T06:30:00.000Z',
};
/** The sum and the total disagree — the page must print both and say so. */
export const DPD_MISMATCH: PartnerBookArrears = { ...DPD_MIXED, servicing: B(13, '2700001') };
export const DPD_EMPTY: PartnerBookArrears = {
  buckets: { no_due_date: B(0, '0'), not_due: B(0, '0'), '1-30': B(0, '0'), '31-60': B(0, '0'), '61-90': B(0, '0'), '90+': B(0, '0') },
  arrears: B(0, '0'), noDueDate: B(0, '0'), servicing: B(0, '0'), noScheduleOnPlatform: false, computedAt: '2026-11-04T06:30:00.000Z',
};

export const COUNTS_5A: PartnerBookCounts = {
  from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27', total: 9,
  byStatus: { active: 3, overdue: 1, restructured: 2, closed: 1, written_off: 2 },
  byKind: { crop: 5, dairy: 2, kcc: 1, not_recorded: 1 },
  outstandingByKindMinor: { crop: '400000', dairy: '9007199254740993', kcc: '10000', not_recorded: '0' },
  principalByKindMinor: { crop: '800000', dairy: '16000000', kcc: '70000', not_recorded: '5000' },
  servicing: { count: 4, outstandingMinor: '9007199254740993' },
  restructured: 2, writtenOff: { count: 2, outstandingMinor: '1250000' },
  computedAt: '2026-11-04T06:30:00.000Z',
};
export const COUNTS_5A_NONE: PartnerBookCounts = { ...COUNTS_5A, restructured: 0, writtenOff: { count: 0, outstandingMinor: '0' },
  byStatus: { ...COUNTS_5A.byStatus, restructured: 0, written_off: 0 } };

/** Strings the view is HANDED (smuggled) and must never print. */
export const SMUGGLED = {
  reason: 'Fixture reason the desk typed',
  borrower: 'Fixture Borrower Person',
  actor: 'Fixture Desk Officer',
  writtenOffAt: '2026-10-21T04:00:00.000Z',
} as const;
const smuggle = (l: PartnerBookLoan): PartnerBookLoan => ({ ...l, writeOffReason: SMUGGLED.reason, borrowerName: SMUGGLED.borrower,
  writtenOffBy: SMUGGLED.actor, writtenOffAt: SMUGGLED.writtenOffAt, borrowerUserId: '0192d2c4-b0b0-7000-8000-000000000001' } as PartnerBookLoan);

export const WRITTEN_OFF: PartnerBookLoan[] = [
  smuggle({ id: '0192d2c4-c0f1-7000-8000-000000000001', applicationId: '0192d2c4-a0f1-7000-8000-000000000001',
    productId: '0192d2c4-p001-7000-8000-00000000000a', productName: 'Fixture seasonal credit', kindCode: 'crop', fpoName: 'Fixture Growers Collective',
    principalMinor: '5000000', interestAprBps: 1100, disbursedAt: '2026-06-15', maturityDate: null, status: 'written_off',
    outstandingMinor: '1100000', nextDueDate: null, openedAt: '2026-06-15T04:00:00.000Z', lastChangedAt: '2026-10-21T04:00:00.000Z' }),
  smuggle({ id: '0192d2c4-c0f2-7000-8000-000000000002', applicationId: '0192d2c4-a0f2-7000-8000-000000000002',
    productId: '0192d2c4-p009-7000-8000-00000000000z', productName: null, kindCode: null, fpoName: null,
    principalMinor: '9007199254740993', interestAprBps: 0, disbursedAt: '2025-12-01', maturityDate: null, status: 'written_off',
    outstandingMinor: '150000', nextDueDate: null, openedAt: '2025-12-01T04:00:00.000Z', lastChangedAt: null }),
];

/** Canon words no 5a page may print outside its refusal list. */
export const FALSE_5A = /%|of book|missed inst|pre-?NPA|cure machinery|vet[- ]visit|nightly|credit[- ]risk role|recovered since|recoveries post|deceased|herd loss|PMFBY|family[- ]assisted|committee sign-?off|board pack|immutable|both causes|never a single officer|LN-20\d\d|Saurashtra|RBI ref|see plan settings|\bDPD\b|\bcurrent\b|lending is (switched )?off/i;
