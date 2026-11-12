// apps/mobile/src/app/__tests__/render/tsc1-real-bugs.render-spec.tsx · PC-56 TSC-1. One render proof per runtime bug
// the 89 mobile type errors were hiding. Each case fails on the base commit (d9ee8e5f) and passes with the fix:
//   1. (worker)/jobs/[id]  — the footer used the removed `busy`/`apply` → ReferenceError on every open job.
//   2. (farmer)/tips       — TIP_CATEGORIES/TipCategory were not imported → ReferenceError on every render.
//   3. (ambassador)/profile — referralFunnel imported from the wrong module → TypeError before the flag gate.
//   4. (worker)/documents  — myDocuments was not exported by kyc.api → the load threw, the screen never left loading.
//      This case runs the REAL kyc.api against a mocked api client (the old render specs mocked kyc.api itself,
//      which is exactly why they never saw the missing export).
//   5. (owner)/farmer-analytics retry, (system)/server-error + tutorial footers — styles referenced but never defined.
//   6. (farmer)/hire/book/confirm — the "verified" pill read `ageVerified18`, which the employer card does not carry.
// `useFlag` is forced ON for the whole file so every screen renders past its flag gate.
import React from 'react';
import { Pressable, Text, View, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Button, EmptyState, SkeletonCard, StatusPill } from '@krishalaya/ui-native';
import { act } from 'react-test-renderer';
import { renderScreen } from '../../../test-utils/render';
import { mockPush, resetExpoRouterMock, searchParams } from '../../../test-utils/expo-router-mock';
import JobDetail from '../../(worker)/jobs/[id]';
import TipsLibrary from '../../(farmer)/tips/index';
import AmbassadorProfile from '../../(ambassador)/profile';
import WorkerDocuments from '../../(worker)/documents';
import FarmerAnalytics from '../../(owner)/farmer-analytics';
import ServerError from '../../(system)/server-error';
import Tutorial from '../../(system)/tutorial';
import BookConfirm from '../../(farmer)/hire/book/confirm';

const openJob = {
  id: 'job-1', bookingNo: 'B-1', employerUserId: 'employer-abcdef', demandTypeId: null, taskSkillId: null, workersNeeded: 2,
  startDate: '2026-12-01', endDate: null, wageKind: 'per_day', wageOfferedMinor: '50000', minWageMinor: '40000', currencyCode: 'INR',
  womenOnly: false, status: 'open', respondBy: null,
};
const mockKycList = jest.fn(async () => [{ id: 'k1', docTypeId: 'dt-aadhaar', status: 'verified' }]);
const mockKycDocTypes = jest.fn(async () => [{ id: 'dt-aadhaar', code: 'aadhaar_card', name: 'Aadhaar' }]);
const mockGetWorkerCard = jest.fn();

jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../core/security/screen-guard', () => ({ useSecureScreen: () => {} }));
jest.mock('../../../core/config', () => ({ config: { appVersion: '0.0.0-test' } })); // the real one fails closed without EXPO_PUBLIC_API_URL
jest.mock('../../../core/auth/auth.store', () => ({
  useAuth: () => ({ state: { status: 'authenticated', profile: { displayName: 'Asha' } }, setLanguage: jest.fn(), signOut: jest.fn() }),
}));
jest.mock('../../../core/api/client', () => ({
  apiClient: () => ({ kyc: { list: () => mockKycList(), docTypes: () => mockKycDocTypes() } }),
}));
jest.mock('../../../features/labour/labour.api', () => ({
  getJob: jest.fn(async () => openJob),
  labourLookups: jest.fn(async () => ({ workTypes: [], skills: [], regions: [] })),
  getMyWorker: jest.fn(async () => ({ id: 'w1', userId: 'u1', ageVerified18: true })),
}));
jest.mock('../../../features/labour/hire.api', () => ({
  createBooking: jest.fn(), assignWorker: jest.fn(),
  getWorker: () => mockGetWorkerCard(),
  labourLookups: jest.fn(async () => ({ workTypes: [], skills: [], regions: [] })),
}));
jest.mock('../../../features/wallet/wallet.api', () => ({
  walletBalance: jest.fn(async () => ({ availableMinor: '0', heldMinor: '0', isFrozen: false, currencyCode: 'INR', failed: false })),
}));
jest.mock('../../../features/content/content.api', () => ({ listTips: jest.fn(async () => ({ items: [], nextCursor: null })) }));
jest.mock('../../../features/ambassador/ambassador.api', () => ({
  myProfile: jest.fn(async () => ({ id: 'a1', userId: 'u1', clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: '0', lastActivityAt: null, isActive: true, createdAt: '2025-01-01T00:00:00Z' })),
  listReferrals: jest.fn(async () => ({ items: [{ id: 'r1', status: 'activated', createdAt: '2026-11-01T00:00:00Z' }, { id: 'r2', status: 'invited', createdAt: '2026-11-02T00:00:00Z' }, { id: 'r3', status: 'rewarded', createdAt: '2026-10-02T00:00:00Z' }], nextCursor: null })),
  myEarnings: jest.fn(async () => ({ items: [], nextCursor: null })),
}));
jest.mock('../../../features/education/education.api', () => ({ myEnrollments: jest.fn(async () => ({ items: [], nextCursor: null })) }));
jest.mock('../../../features/profile/profile.api', () => ({ myBankAccounts: jest.fn(async () => []) }));
jest.mock('../../../features/tenant/tenant.api', () => ({
  assignments: jest.fn(async () => { throw new Error('offline'); }),
  tenantAnalytics: jest.fn(async () => null),
}));

const flat = (style: StyleProp<TextStyle>): TextStyle => StyleSheet.flatten(style) ?? {};
const textOf = (n: { props: { children?: unknown } }) => {
  const c = n.props.children;
  return Array.isArray(c) ? c.join('') : typeof c === 'string' ? c : '';
};

beforeEach(() => { resetExpoRouterMock(); mockKycList.mockClear(); mockGetWorkerCard.mockReset(); });

describe('TSC-1 · (worker)/jobs/[id] — Apply opens the confirm-and-apply screen', () => {
  it('renders an open job and Apply pushes jobs/apply/[id]', async () => {
    searchParams.id = 'job-1';
    const r = await renderScreen(<JobDetail />);
    const apply = r.root.findAllByType(Button).find((b) => String(b.props.title).startsWith('Apply'));
    expect(apply).toBeDefined();
    act(() => { apply!.props.onPress(); });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(worker)/jobs/apply/[id]', params: { id: 'job-1' } });
  });
});

describe('TSC-1 · (farmer)/tips — the topic tabs render', () => {
  it('renders the five category tabs with only "All" usable', async () => {
    const r = await renderScreen(<TipsLibrary />);
    const tabs = r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === 'tab');
    expect(tabs).toHaveLength(5);
    expect(tabs.filter((tab) => !tab.props.disabled)).toHaveLength(1);
  });
});

describe('TSC-1 · (ambassador)/profile — the referral funnel counts', () => {
  it('renders and counts the real referrals (no TypeError from a missing import)', async () => {
    const r = await renderScreen(<AmbassadorProfile />);
    expect(r.root.findAllByType(SkeletonCard)).toHaveLength(0);
    const texts = r.root.findAllByType(Text).map(textOf);
    expect(texts).toContain('Asha');
    expect(texts).toContain('3'); // the "farmers" tile = referralFunnel(refs).total over the three referrals
  });
});

describe('TSC-1 · (worker)/documents — reads the KYC documents through the real kyc.api', () => {
  it('calls kyc.list and leaves the loading state', async () => {
    const r = await renderScreen(<WorkerDocuments />);
    expect(mockKycList).toHaveBeenCalledTimes(1);
    expect(r.root.findAllByType(SkeletonCard)).toHaveLength(0);
  });
});

describe('TSC-1 · styles that were referenced but never defined', () => {
  it('(owner)/farmer-analytics: the retry control is styled', async () => {
    const r = await renderScreen(<FarmerAnalytics />);
    expect(r.root.findAllByType(EmptyState).length).toBeGreaterThan(0);
    const retry = r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && n.findAllByType(Text).some((tx) => textOf(tx) === 'Retry'));
    expect(retry.length).toBeGreaterThan(0);
    expect(flat(retry[0].props.style)).toMatchObject({ alignItems: 'center' });
    const label = retry[0].findAllByType(Text).find((tx) => textOf(tx) === 'Retry')!;
    expect(flat(label.props.style)).toHaveProperty('fontWeight');
  });

  it.each([['server-error', ServerError], ['tutorial', Tutorial]])('(system)/%s: the two footer buttons sit in a row', async (_name, Screen) => {
    const r = await renderScreen(<Screen />);
    const rows = r.root.findAll((n) => n.type === View && n.findAllByType(Button).length === 2 && flat(n.props.style).flexDirection === 'row');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('TSC-1 · (farmer)/hire/book/confirm — the verified pill reads the employer card', () => {
  it('shows "verified" for an age-verified worker card', async () => {
    searchParams.workerId = 'worker-xyz';
    searchParams.inputJson = JSON.stringify({ demandTypeCode: 'daily', taskSkillId: 's1', regionId: 'r1', skillLevel: 'unskilled', workersNeeded: 1, startDate: '2026-12-01', endDate: '2026-12-01', wageOfferedMinor: '50000', farmLat: 22.5, farmLng: 72.9 });
    mockGetWorkerCard.mockResolvedValue({ id: 'worker-xyz', userId: 'u2', villageRegionId: null, travelKm: null, stayAwayOk: null, ageVerified: true, discoverable: false, minWageExpectationMinor: null, displayName: null, ratingAvg: null, bookingsCompleted: null });
    const r = await renderScreen(<BookConfirm />);
    expect(r.root.findAllByType(StatusPill).map((p) => p.props.label)).toContain('Verified');
  });
});
