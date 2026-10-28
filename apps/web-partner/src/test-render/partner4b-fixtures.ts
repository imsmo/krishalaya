// apps/web-partner/src/test-render/partner4b-fixtures.ts · PC-56 PARTNER-4b · WHAT A LENDER DOES NOT DISBURSE — the render tests' shared
// fixtures: the pipeline counts as the server answers them, the collected window, and the arrears buckets in the shape this platform actually
// produces — FOUR ZEROS and a count of loans with no due date recorded, which is the honest answer and the thing the page must explain.
// Neutral figures only; no person, no bank, no place, no account tail, no loan number, no avatar.
import type { PartnerBookArrears, PartnerBookCollected, PartnerBookPipeline } from '@krishalaya/sdk-js';

export const PIPELINE: PartnerBookPipeline = {
  from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27',
  ready: 8, coolingOff: 6, disbursed: 61, approved: 14, pipeline: 75, computedAt: '2026-10-28T06:30:00.000Z',
};
export const PIPELINE_EMPTY: PartnerBookPipeline = { ...PIPELINE, ready: 0, coolingOff: 0, disbursed: 0, approved: 0, pipeline: 0 };

export const COLLECTED: PartnerBookCollected = {
  from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27',
  repayments: 3, amountPaidMinor: '1254000', loans: 2, computedAt: '2026-10-28T06:30:00.000Z',
};
export const COLLECTED_EMPTY: PartnerBookCollected = { ...COLLECTED, repayments: 0, amountPaidMinor: '0', loans: 0 };

const B = (count: number, outstandingMinor: string) => ({ count, outstandingMinor });
/** THE TRUTH OF THIS PLATFORM: every loan is opened with no next due date, so all four arrears buckets are 0 and `no_due_date` holds them
 *  all. The page must print the four zeros AND the reason, with the count — never the zeros alone. */
export const ARREARS: PartnerBookArrears = {
  buckets: {
    '1-30': B(0, '0'), '31-60': B(0, '0'), '61-90': B(0, '0'), '90+': B(0, '0'),
    not_due: B(0, '0'), no_due_date: B(4, '9007199254740993'),
  },
  arrears: B(0, '0'),
  noDueDate: B(4, '9007199254740993'),
  servicing: B(4, '9007199254740993'),
  noScheduleOnPlatform: true,
  computedAt: '2026-10-28T06:30:00.000Z',
};
/** The same book on a platform that HAD due dates — so the page's other three reasons are rendered too, not only the one that is true today. */
export const ARREARS_MIXED: PartnerBookArrears = {
  buckets: {
    '1-30': B(2, '480000'), '31-60': B(1, '120000'), '61-90': B(0, '0'), '90+': B(1, '240000'),
    not_due: B(5, '1500000'), no_due_date: B(3, '300000'),
  },
  arrears: B(4, '840000'), noDueDate: B(3, '300000'), servicing: B(12, '2640000'),
  noScheduleOnPlatform: false, computedAt: '2026-10-28T06:30:00.000Z',
};
export const ARREARS_EMPTY: PartnerBookArrears = {
  buckets: {
    '1-30': B(0, '0'), '31-60': B(0, '0'), '61-90': B(0, '0'), '90+': B(0, '0'),
    not_due: B(0, '0'), no_due_date: B(0, '0'),
  },
  arrears: B(0, '0'), noDueDate: B(0, '0'), servicing: B(0, '0'), noScheduleOnPlatform: false,
  computedAt: '2026-10-28T06:30:00.000Z',
};

/** Words no 4b page may print outside its refusal list — 4a's pattern plus this wave's own canon claims. */
export const FALSE_4B = /disburs(e\b|es\b|e[- ]|al\b|als\b|ing\b|ement)|co-?approv|disbursal[- ]?officer|collections role|code of conduct|contact hours \d|third[- ]?party agents?|violation|partner suspension|penny[- ]?drop|supplier[- ]?direct|auto[- ]?retr|gentle[- ]?nudge|\bT-3\b|mediation scheduled|••|both sides|auto[- ]?assembl|\bDPD\b|\bPAR\b|\bon[- ]?time\b|schedul|sanction letter|origination fee|milk bill|\bherds?\b|cattle insurance|Kotak|\bSBI\b|Saurashtra|Gramin|Anand|Mehsana|Junagadh|LA-2026|LN-2026|KCC-2026|XXXX-XXXX|\bAJ\b|RBI ref|\bBen\s|Bhai|\+91/i;
