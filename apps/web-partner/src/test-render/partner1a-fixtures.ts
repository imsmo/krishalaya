// apps/web-partner/src/test-render/partner1a-fixtures.ts · PC-56 PARTNER-1a — the render tests' shared fixtures (survey B3 shape): a dashboard
// read as the API answers it, a /me, a team. Neutral names only; no person's name is an applicant's (the read carries none).
import type { PartnerDashboard, PartnerMe, PartnerTeam } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';

export const tr = (cat: Record<string, string>) => ({ t: (key: string, vars: Record<string, string | number> = {}) => (cat[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (_m, n) => (n in vars ? String(vars[n]) : `{${n}}`)) });
/** Text of the markup with tags removed and the entities React escapes restored (for sentence assertions). */
export const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
export const words = (s: string) => s.replace(/\s+/g, ' ');

export const FIGURES: PartnerDashboard = {
  computedAt: '2026-10-18T06:30:00.000Z',
  applicationsTotal: 131,
  awaitingDecision: 104,
  decidedThisMonth: { decided: 7, approved: 5, rejected: 2, approvedAmountMinor: '1250000000', approvalRateBps: 7142, monthStartsAt: '2026-09-30T18:30:00.000Z', timeZone: 'Asia/Kolkata' },
  portfolio: { outstandingMinor: '9007199254740993', activeLoans: 3 },
  onTime: { windowDays: 90, due: 4, onTime: 3, shareBps: 7500, basis: 'recorded_instalments' },
  sla: { decisionPromiseHours: 48, windowDays: 30, decided: 7, medianSec: 3600 * 31, p90Sec: 3600 * 50, withinPromise: 6 },
  fpos: [{ tenantId: 'aaaaaaaa-0000-7000-8000-000000000001', name: 'Fixture Growers Collective' }, { tenantId: 'bbbbbbbb-0000-7000-8000-000000000002', name: null }],
  needsYouToday: [
    { id: '0192d2c4-1111-7000-8000-000000000001', tenantId: 'aaaaaaaa-0000-7000-8000-000000000001', fpoName: 'Fixture Growers Collective', productName: 'Fixture crop loan', amountRequestedMinor: '30000000', status: 'submitted', createdAt: '2026-10-15T06:30:00.000Z' },
    { id: '0192d2c4-2222-7000-8000-000000000002', tenantId: 'bbbbbbbb-0000-7000-8000-000000000002', fpoName: null, productName: 'Fixture crop loan', amountRequestedMinor: '5000000', status: 'under_review', createdAt: '2026-10-18T00:30:00.000Z' },
  ],
};
export const EMPTY: PartnerDashboard = { ...FIGURES, applicationsTotal: 0, awaitingDecision: 0,
  decidedThisMonth: { ...FIGURES.decidedThisMonth, decided: 0, approved: 0, rejected: 0, approvedAmountMinor: '0', approvalRateBps: null },
  portfolio: { outstandingMinor: '0', activeLoans: 0 }, onTime: { ...FIGURES.onTime, due: 0, onTime: 0, shareBps: null },
  sla: { ...FIGURES.sla, decisionPromiseHours: null, decided: 0, medianSec: null, p90Sec: null, withinPromise: null }, fpos: [], needsYouToday: [] };

export const ME: PartnerMe = {
  organisation: { id: 'p-1', code: 'fixture_bank', name: 'Fixture Lending Partner', kind: 'bank', regulatorRefMasked: '••••4471', sla: { decision_hours: 48 }, slaDecisionHours: 48 },
  person: { userId: 'u-1', roles: ['partner_admin'], permissions: ['partner.applications.read', 'partner.team.manage'], phoneMasked: '••••••318' },
  realm: 'partner',
};
export const TEAM: PartnerTeam = {
  members: [
    { membershipId: 'm-1', userId: 'u-1', name: 'Fixture Administrator', phoneMasked: '••••••318', roleCode: 'partner_admin', active: true, since: '2026-10-01T05:00:00.000Z', removedAt: null, removedReason: null, twoFactor: true },
    { membershipId: 'm-2', userId: 'u-2', name: 'Fixture Checker', phoneMasked: '••••••412', roleCode: 'partner_checker', active: true, since: '2026-10-02T05:00:00.000Z', removedAt: null, removedReason: null, twoFactor: false },
    { membershipId: 'm-3', userId: 'u-3', name: 'Removed Person', phoneMasked: '••••••999', roleCode: 'partner_viewer', active: false, since: '2026-09-02T05:00:00.000Z', removedAt: '2026-10-03T05:00:00.000Z', removedReason: 'left the bank team', twoFactor: false },
  ],
  invites: [{ id: 'i-1', phoneMasked: '••••••777', roleCode: 'partner_maker', invitedBy: 'u-1', expiresAt: '2026-10-25T05:00:00.000Z', sentAt: null, sendFailure: null, createdAt: '2026-10-18T05:00:00.000Z' }],
};
