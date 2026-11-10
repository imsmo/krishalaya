// apps/web-gov/src/test-render/gov1b-fixtures.ts · PC-56 GOV-1b — the overview AS `GET /v1/gov/overview` GIVES IT (GOV1-B5): every number the
// server's (this fixture's totals are what the server would have counted; the page must print them, never compute them). No canon person,
// place, body or figure: plainly test names and round test numbers.
import type { GovOverview } from '@krishalaya/sdk-js';

const z = { submitted: 0, under_verification: 0, clarification_needed: 0, approved: 0, rejected: 0, disbursed: 0, closed: 0, appealed: 0 };
export const OVERVIEW: GovOverview = {
  window: { kind: 'all_time', draftsCounted: false },
  computedAt: '2026-11-10T06:30:00.000Z',
  schemes: { count: 2 },
  byScheme: [
    { scheme: { id: '0192d2c4-b000-7000-8000-000000000001', code: 'test_scheme_a', name: 'Test Scheme A' }, total: 55, byStatus: { ...z, submitted: 30, clarification_needed: 5, appealed: 3, approved: 15, rejected: 2 } },
    { scheme: { id: '0192d2c4-b000-7000-8000-000000000002', code: 'test_scheme_b', name: 'Test Scheme B' }, total: 9, byStatus: { ...z, submitted: 6, clarification_needed: 2, disbursed: 1 } },
  ],
  totals: { total: 64, byStatus: { ...z, submitted: 36, clarification_needed: 7, appealed: 3, approved: 15, rejected: 2, disbursed: 1 } },
  queues: [{ status: 'clarification_needed', count: 7, oldestDays: 9 }, { status: 'appealed', count: 3, oldestDays: 20 }],
};
/** An authority that runs schemes, none applied to yet. */
export const OVERVIEW_EMPTY: GovOverview = { ...OVERVIEW, byScheme: OVERVIEW.byScheme.map((r) => ({ ...r, total: 0, byStatus: { ...z } })), totals: { total: 0, byStatus: { ...z } },
  queues: [{ status: 'clarification_needed', count: 0, oldestDays: null }, { status: 'appealed', count: 0, oldestDays: null }] };
/** An authority that runs no scheme. */
export const OVERVIEW_NO_SCHEME: GovOverview = { ...OVERVIEW_EMPTY, schemes: { count: 0 }, byScheme: [] };

/** W325 / W358's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_1B = /%|₹|\bINR\b|rupee|season|target|district|\bSLA\b|approval rate|median|average|\bavg\b|flagged|PFMS|confirmed by|fixable|emblem|GIGW|certif|pay on time|two-person|Directorate|Gujarat|Dahod|GMISS|plan settings|walks back/i;
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
