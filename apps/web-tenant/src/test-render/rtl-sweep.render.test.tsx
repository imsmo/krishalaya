// apps/web-tenant/src/test-render/rtl-sweep.render.test.tsx · PC-56 TENANT-CLOSE · RTL spot-check.
//
// One REAL page (or shared component) per tenant sweep wave, mounted inside <div dir="rtl">:
//   SW-a  /money/commission                 the commission rules table (and its range arrow)
//   SW-b  /ops/labour/attendance            the attendance tiles + review table
//   SW-c  /settings/team                    the team table, pairs, invites
//   SW-d  /insights/governance/agm/[id]     the AGM pack's section table (one figure, one refusal)
//   SW-e  /ops/logistics/cold-chain/[id]    the cold-chain subject's reading trail
//   SW-f  /insights/reports                 the report catalogue, runs (range arrow), schedules
//   SW-f  AsOfView (stale) · SignalBanner ("— needs signal") · StaleDiffChip
// Asserts (a) each renders without throwing, (b) no element carries a PHYSICAL-direction class (Tailwind ml-/mr-/pl-/pr-/left-/
// right-/text-left/right/rounded-l/r/border-l/r/float-*) or a physical inline style (margin/padding-left/right, left:/right:,
// text-align:left/right), (c) a range arrow "→" only ever appears inside the flipping `.kv-dir-flip` span, and the stale / AsOf
// text and the "— needs signal" label render.
//
// HOW THE PAGES RUN HERE: they are async server components. The request-scoped modules they import (lib/session, lib/auth,
// lib/i18n — next/headers — and lib/api-client) are replaced by jest.mock with deterministic fixtures; the page function is then
// awaited for its element tree, which renderToStaticMarkup renders (node env, the same zero-new-dependency harness this config's
// header documents). Every fixture is typed against the SDK, so `tsc` checks it against the real shapes.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Translator } from '@krishalaya/i18n';
import type {
  AgmPack, AttendanceReviewRow, AttendanceReviewSummary, ColdSubjectDetail, CommissionRule, ReportCatalogue, ReportDefinition, ReportRun, ReportSchedule, TeamOverview,
} from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

jest.mock('../lib/session', () => ({ requireSession: async () => ({}) }));
jest.mock('../lib/auth', () => ({ tenantHasPerm: () => false, hasSessionCookie: () => true }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return {
    getLang: () => 'en',
    getLanguageDef: () => ({ code: 'en', dir: 'ltr' }),
    getTranslator: () => new T('en').register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')),
  };
});
jest.mock('../lib/env', () => ({ env: { appName: 'Krishalaya', featureLabour: true } })); // lib/env fails closed without NEXT_PUBLIC_API_URL; the pages here read only these
// the cold-chain page imports its server actions; never invoked here (no manage permission → the forms are not rendered)
jest.mock('../app/ops/logistics/cold-chain/[id]/actions', () => ({ exportTrailAction: async () => undefined, recordManualReadingAction: async () => undefined }));

const U = (n: number) => `0190a8b2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-04T09:48:00.000Z';

const rule: CommissionRule = {
  id: U(1), scope: 'tenant', categoryId: null, source: 'direct', sellerRoleId: null, rateBps: 250, fixedMinor: '0', capMinor: '50000', platformShareBps: 50,
  chargedTo: 'seller', priority: 10, effectiveFrom: '2026-04-01', effectiveTo: '2027-03-31', isActive: true, status: 'in_force',
};
const attRow: AttendanceReviewRow = {
  id: U(2), assignmentId: U(3), bookingId: U(4), bookingNo: 'LB-1042', workDate: '2026-10-03', workerId: U(5), workerShortName: 'Ramesh P.', workerPhoneMasked: '+91 ••••• •4521',
  clockInAt: '2026-10-03T03:30:00Z', clockOutAt: '2026-10-03T11:30:00Z', fenceDistanceM: 40, outOfFence: false, hoursRegular: '8', hoursOvertime: '0',
  method: 'self', reviewStatus: 'none', status: 'clocked_out', confirmed: false, confirmedBy: null, confirmedAt: null, vouchedBy: null, vouchReason: null, recordedBy: null,
  backfillMediaId: null, backfillReason: null, paid: false, viewerIsWorker: false, viewerIsEmployer: true,
};
const attTiles: AttendanceReviewSummary = { clean: 12, needsReview: 2, paperBackfill: 1, unconfirmed24h: 3, workersToday: 9, activeJobs: 4, fenceM: 100, offlineDeviceStore: { built: false, reason: 'not built' } };
const team: TeamOverview = {
  seats: { kind: 'limited', used: 3, seats: 5, planName: 'Growth', full: false },
  staff: [{ userId: U(6), name: 'Asha Patel', roles: ['tenant_admin'], desks: [{ id: U(7), code: 'kyc', name: 'KYC desk' }], overrides: 1, twoFactor: 'confirmed', lastActiveAt: AT, since: AT, suspended: false }],
  nextCursor: null,
  pairs: [{ code: 'wallet.payout', enforcedBy: 'database', makers: [{ userId: U(6), name: 'Asha Patel' }], checkers: [], live: false }], pairsOver: 1,
  invites: [{ id: U(8), phoneMasked: '+91 ••••• •7788', roleCode: 'staff', deskIds: [], invitedBy: U(6), invitedByName: 'Asha Patel', languageCode: 'gu', channel: 'sms', status: 'pending',
    expiresAt: AT, sentAt: AT, sendFailure: null, acceptedUserId: null, acceptedAt: null, revokedBy: null, revokedAt: null, revokeReason: null, createdAt: AT, live: true }],
  proposals: [], staffRoles: ['staff'], invitesEnabled: true, sessionEndBoundSec: 60, accessTokenTtlSec: 900,
};
const agm: AgmPack = {
  id: U(9), fiscalYearLabel: 'FY 2025-26', fyStart: '2025-04-01', fyEnd: '2026-03-31', fyStartMonth: 4, fyBasisSource: 'country_default', zone: 'Asia/Kolkata', secondLanguage: 'gu',
  status: 'draft', draftedBy: U(6), draftedByName: 'Asha Patel', assembledAt: AT, issuedBy: null, issuedByName: null, issueRequestedAt: null, confirmedBy: null, confirmedByName: null,
  confirmedAt: null, issuedAt: null, documentId: null, pdfSha256: null, contentSha256: null, pdfMediaId: null, exportJobId: null, exportNote: null, parentPackId: null,
  parentDocumentId: null, addendumNo: 0, reason: null, supersededBy: null, auditorMediaId: null, renderAttempts: 0, renderError: null, withdrawnAt: null, withdrawReason: null,
  createdAt: AT, verifyPath: null, qr: 'refused',
  sections: [
    { section: 'income_expenditure', item: 'gmv', status: 'included', method: 'sum(order_lines.goods_minor)', refusalCode: null, figures: { goodsMinor: '12500000', currency: 'INR', orders: 42 }, sourceRefs: [] },
    { section: 'auditor_annexure', item: 'annexure', status: 'refused', method: 'auditor upload', refusalCode: 'NO_AUDITOR_UPLOAD', figures: {}, sourceRefs: [] },
  ],
};
const cold: ColdSubjectDetail = {
  subjectType: 'shipment', subjectId: U(10), label: 'SHP-2201', status: 'in_range', windowHours: 72,
  band: { id: U(11), minC: '2', maxC: '8', setBy: U(6), reason: 'milk', effectiveFrom: AT, createdAt: AT }, bandHistory: [],
  device: { id: U(12), serial: 'TL-0091', lastReadingAt: AT }, nextCursor: null, breaches: [],
  trail: [{ id: U(13), subjectType: 'shipment', subjectId: U(10), tempC: 4.2, humidityPct: null, deviceRef: 'TL-0091', isBreach: false, excursion: false, band: { minC: 2, maxC: 8 },
    source: 'device', deviceId: U(12), recordedAt: AT, serverRecordedAt: AT, sequenceNo: '881' }],
  playbook: { rule: 'r', manualNeverOpens: true, buyerOfferAfterMinutes: 30, silenceMinutes: 60, alerted: 'alerted' },
  refused: { bothTenants: 'BOTH_TENANTS', autoCall: 'AUTO_CALL', playbookRun: 'PLAYBOOK_RUN', signedExport: 'SIGNED_EXPORT' }, retentionMonths: 24,
};
const catalogue: ReportCatalogue = {
  datasets: [{ code: 'orders', dimensions: ['day'], measures: [{ key: 'orders', kind: 'count' }], currencyDimension: null, unitDimension: null, auditorRealm: false, permitted: true, refusal: null, planeDataset: null }],
  bounds: { maxRangeDays: 92, rowCap: 50000, statementTimeout: '60s', maxDimensions: 3, maxMeasures: 4 },
  replica: { kind: 'refused', code: 'REPLICA_NOT_PROVISIONED' }, memberDimension: { kind: 'refused', code: 'MEMBER_DIMENSION' }, signed: { kind: 'refused', code: 'SIGNED_EXPORT' },
  watermarked: true, audited: true, recipientRoles: ['tenant_admin'], planeRegistry: [],
};
const run: ReportRun = {
  id: U(14), definitionId: null, scheduleId: null, datasetCode: 'orders', dimensions: ['day'], measures: ['orders'], fromDay: '2026-09-01', toDay: '2026-09-30', requestedBy: U(6),
  status: 'ready', rowCount: 30, exportJobId: null, statementMs: 120, statementTimeout: '60s', watermark: 'w', errorCode: null, errorDetail: null, queuedAt: AT, startedAt: AT, finishedAt: AT,
};

const page = <T,>(items: T[]) => ({ items, nextCursor: null });
const mockClient = {
  auth: { me: async () => ({ id: U(6) }) },
  tenantConfig: {
    commissionRules: async () => ({ ...page([rule]), platformShareBps: 50 }),
    commissionPolicy: async () => { throw new Error('not needed'); },
    commissionProposals: async () => page([]),
    commissionResolution: async () => { throw new Error('not needed'); },
  },
  labour: { attendanceReview: async () => page([attRow]), attendanceSummary: async () => attTiles },
  team: { overview: async () => team },
  agmPacks: { get: async () => agm },
  coldChain: { subject: async () => cold },
  reports: {
    catalogue: async () => catalogue, definitions: async () => page([] as ReportDefinition[]), runs: async () => page([run]), schedules: async () => page([] as ReportSchedule[]),
  },
};
jest.mock('../lib/api-client', () => ({ tenantClient: () => mockClient }));

import CommissionPage from '../app/money/commission/page';
import AttendanceReviewPage from '../app/ops/labour/attendance/page';
import TeamPage from '../app/settings/team/page';
import AgmPackPage from '../app/insights/governance/agm/[id]/page';
import ColdSubjectPage from '../app/ops/logistics/cold-chain/[id]/page';
import ReportsPage from '../app/insights/reports/page';
import { AsOfView } from '../components/AsOf';
import { SignalBanner } from '../components/OnlineGuard';
import { StaleDiffChip } from '../components/StaleDiffChip';
import { asOfLabels, signalLabels, staleLabels } from '../features/swf/console';

const t = new Translator('en').register('en', en).register('hi', hi).register('gu', gu);
const rtl = (el: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{el}</div>);

// (b) physical-direction utilities (Tailwind spellings) as whole class tokens, and physical inline styles
const PHYSICAL_CLASS = /^-?(?:m[lr]|p[lr]|left|right)-|^(?:text-(?:left|right)|float-(?:left|right))$|^(?:rounded-[lr]|border-[lr])(?:-|$)/;
const PHYSICAL_STYLE = /(?:margin|padding|border)-(?:left|right)|(?:^|;)\s*(?:left|right)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/;
function physical(html: string): string[] {
  const hits: string[] = [];
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c && PHYSICAL_CLASS.test(c)) hits.push(c);
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) if (PHYSICAL_STYLE.test(m[1])) hits.push(`style="${m[1]}"`);
  return hits;
}
// (c) a range arrow outside the flipping span would point backwards under rtl
const bareArrows = (html: string) => (html.replace(/<span class="kv-dir-flip">→<\/span>/g, '').match(/[→←]/g) ?? []).length;

describe('the regex guards themselves (so a pass below means something)', () => {
  it('flags physical classes and styles, passes logical ones', () => {
    expect(physical('<p class="ml-2 pr-4 text-right rounded-l-md border-r float-left left-0"></p>')).toHaveLength(7);
    expect(physical('<p style="margin-left:4px"></p><p style="text-align:right"></p><p style="right: 0"></p>')).toHaveLength(3);
    expect(physical('<p class="ms-2 pe-4 text-start rounded-s-md border-e start-0 kv-table kv-btn--link kv-pager"></p><p style="margin-inline-start:4px;overflow-wrap:anywhere"></p>')).toEqual([]);
    expect(bareArrows('a <span class="kv-dir-flip">→</span> b')).toBe(0);
    expect(bareArrows('a → b')).toBe(1);
  });
});

describe('sweep pages render under dir="rtl" with logical direction only', () => {
  const cases: Array<[string, () => Promise<React.ReactNode>, string[]]> = [
    ['SW-a commission table', () => CommissionPage({ searchParams: {} }), [t.t('swa.com.title'), t.t('swa.com.col.effective'), '2.50%']],
    ['SW-b attendance tiles', () => AttendanceReviewPage({ searchParams: {} }), [t.t('swb.att.tile.clean'), t.t('swb.att.tile.needsReview'), 'Ramesh P.', 'LB-1042']],
    ['SW-c team table', () => TeamPage({ searchParams: {} }), [t.t('swc.team.title'), 'Asha Patel', '+91 ••••• •7788']],
    ['SW-d AGM section table', () => AgmPackPage({ params: { id: U(9) } }), [t.t('swd.agm.sections'), 'NO_AUDITOR_UPLOAD', 'sum(order_lines.goods_minor)']],
    ['SW-e cold-chain trail', () => ColdSubjectPage({ params: { id: U(10) }, searchParams: { type: 'shipment' } }), ['SHP-2201', '4.2 °C', '#881']],
    ['SW-f reports catalogue', () => ReportsPage({ searchParams: {} }), [t.t('swf.reports.title'), t.t('swf.reports.runs'), '2026-09-01']],
  ];
  it.each(cases)('%s', async (_name, mount, expected) => {
    const html = rtl(await mount());
    expect(html.startsWith('<div dir="rtl">')).toBe(true);
    for (const s of expected) expect(html).toContain(s.replace(/&/g, '&amp;'));
    expect(html).toContain('data-kv-stale="false"'); // every sweep data page carries its as-of banner
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('the range arrows that were bare are now the flipping span (commission effective dates, report run range)', async () => {
    expect(rtl(await CommissionPage({ searchParams: {} }))).toMatch(/<span class="kv-dir-flip">→<\/span>/);
    expect(rtl(await ReportsPage({ searchParams: {} }))).toContain('2026-09-01 <span class="kv-dir-flip">→</span> 2026-09-30');
  });
});

describe('shared sweep components under dir="rtl"', () => {
  it('AsOf: absolute + relative, and the stale WORD past one hour', () => {
    const html = rtl(<AsOfView at={AT} now={new Date(Date.parse(AT) + 82 * 60_000)} labels={asOfLabels(t)} />);
    expect(html).toContain('2026-10-04 15:18 IST');
    expect(html).toContain('(1 h 22 min ago)');
    expect(html).toContain('data-kv-stale="true"');
    expect(html).toContain('Stale — older than one hour');
    expect(physical(html)).toEqual([]);
  });
  it('degraded mode: the banner and the "— needs signal" label', () => {
    const html = rtl(<SignalBanner mode="degraded" labels={signalLabels(t)} />);
    expect(html).toContain('No signal — read-only');
    expect(html).toContain('— needs signal');
    expect(physical(html)).toEqual([]);
  });
  it('the diff chip: field · was · now, nothing written', () => {
    const html = rtl(<StaleDiffChip code="STALE_ROW" diffs={[{ field: 'status', was: 'proposed', now: 'confirmed' }]} labels={staleLabels(t)} recheckHref="/x/act?step=confirm" />);
    expect(html).toContain('data-kv-stale-row="STALE_ROW"');
    expect(html).toContain('Nothing was written.');
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
});
