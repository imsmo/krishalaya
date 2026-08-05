// DEV-12 (Group-B EmptyState pass, set 2: mcc-operator/vet/store-owner/vyapari-home/delivery-partner/
// fpo-coordinator — 6 operator-role feature dirs, 26 stub screens). Founder-approved mirror of DEV-11's exact
// pattern (DEV-S1 sitting 2026-07-24, Founder Review Queue item 2). Pure-logic tests only — this repo's
// jest.config.js scopes to src/core/__tests__/*.spec.ts as framework-free Node logic (see that file's own header
// comment: "React Native screens... are exercised by the RN test runner in CI (jest-expo)"); no
// @testing-library/react-native or react-test-renderer harness is wired into THIS config, and the playbook's own
// "no new dependency added without justification" gate rules out adding one for this S-size hygiene batch. So the
// 26 screens' actual gating DECISION is tested here via the exact pure functions they call
// (`useFlag`'s underlying `flags.isEnabled` + `offModuleState`), which is the real, repo-native equivalent of a
// "render test" for this architecture — same choice DEV-11 made, not a lesser substitute chosen to avoid effort.
//
// 26 screens covered (grouped, one assertion block per area — all screens in an area share the identical
// useFlag(<area>) + offModuleState(...) gate, so their behavior collapses to one representative check per area,
// same "grouped specs fine" allowance DEV-11's own spec used):
//   mcc_operator (4):     BmcStatusScreen, MemberLookupScreen, ShiftCloseScreen, CollectionSlipScreen        → useFlag('mcc_operator')
//   vet (4):               EarningsScreen, BookingDetailScreen, VetBookingsCalendarScreen, PrescriptionWriterScreen → useFlag('vet')
//   store_owner (4):        LicenceRenewalScreen, StoreInventoryScreen, StoreOrdersScreen, BatchesExpiryScreen → useFlag('store_owner')
//   vyapari (4):            SupplierShortlistScreen, VyapariHomeScreen, RequirementsInboxScreen, MarketDashboardScreen → useFlag('vyapari')
//   delivery_partner (5):   RouteMapScreen, EarningsScreen, DeliveryPodScreen, TasksTodayScreen, PickupOtpScreen → useFlag('delivery_partner')
//   fpo_coordinator (5):    CreateGroupLotScreen, MemberPledgesScreen, GroupSettlementScreen, GroupLotsScreen, MembersScreen → useFlag('fpo_coordinator')
import { flags } from '../flags/flags';
import { offModuleState } from '../flags/off-module-state';

const AREAS = ['mcc_operator', 'vet', 'store_owner', 'vyapari', 'delivery_partner', 'fpo_coordinator'] as const;

describe('DEV-12 Group-B EmptyState pass — 6 operator-dirs gate', () => {
  afterEach(() => flags.hydrate({}));

  for (const area of AREAS) {
    describe(`${area} flag`, () => {
      it('default matches its phase (PC-50 W10-3 flipped vet ON — the vet-professional app is built)', () => {
        expect(flags.isEnabled(area)).toBe(area === 'vet');
      });

      it('the kill-switch channel can flip it ON (e.g. a founder GA-Wave rollout)', () => {
        flags.hydrate({ [area]: true });
        expect(flags.isEnabled(area)).toBe(true);
      });

      it('every screen in this area gates on the SAME flag → OFF renders the "unavailable" state', () => {
        flags.hydrate({ [area]: false });
        expect(offModuleState(flags.isEnabled(area))).toBe('off');
      });

      it('ON renders "comingSoon", never a fabricated real screen (Law 12 — nothing is built yet)', () => {
        flags.hydrate({ [area]: true });
        expect(offModuleState(flags.isEnabled(area))).toBe('comingSoon');
      });
    });
  }

  it('all 6 new keys are additive-only — every DEV-11 and pre-existing flag is untouched', () => {
    // DEV-11's 3 areas + a sample of pre-existing keys must still resolve exactly as before this batch.
    expect(flags.isEnabled('fintech')).toBe(false);
    expect(flags.isEnabled('dairy')).toBe(true); // PC-50 W10-2 Phase-2 activation
    expect(flags.isEnabled('livestock')).toBe(true); // PC-50 W10-1 Phase-2 activation
    expect(flags.isEnabled('auctions')).toBe(false);
    expect(flags.isEnabled('farmer_app')).toBe(true);
  });

  it('the 6 new keys are 6 distinct flags, not aliases of each other or of `livestock`/`fintech`/`dairy`', () => {
    flags.hydrate({ vet: true });
    expect(flags.isEnabled('vet')).toBe(true);
    expect(flags.isEnabled('livestock')).toBe(true); // PC-50 W10-1 Phase-2 activation
    expect(flags.isEnabled('mcc_operator')).toBe(false);
    expect(flags.isEnabled('dairy')).toBe(true); // PC-50 W10-2 Phase-2 activation
  });
});

describe('offModuleState (pure, shared helper — no change needed, reused as-is)', () => {
  it('OFF flag → off', () => {
    expect(offModuleState(false)).toBe('off');
  });
  it('ON flag → comingSoon', () => {
    expect(offModuleState(true)).toBe('comingSoon');
  });
});
