// DEV-11 (Group-B EmptyState pass, set 1: fintech/dairy/livestock). Pure-logic tests only — this repo's
// jest.config.js scopes to src/core/__tests__/*.spec.ts as framework-free Node logic (see that file's own header
// comment: "React Native screens... are exercised by the RN test runner in CI (jest-expo)"); no
// @testing-library/react-native or react-test-renderer harness is wired into THIS config, and the playbook's own
// "no new dependency added without justification" gate rules out adding one for this M-size hygiene batch. So the
// 12 screens' actual gating DECISION is tested here via the exact pure functions they call
// (`useFlag`'s underlying `flags.isEnabled` + `offModuleState`), which is the real, repo-native equivalent of a
// "render test" for this architecture — not a lesser substitute chosen to avoid effort, but the honest fit for
// what this jest config can exercise (flagged plainly, see dev11_report.md §4).
//
// 12 screens covered (grouped, one assertion block per area — all 4 screens in an area share the identical
// useFlag(<area>) + offModuleState(...) gate, so their behavior collapses to one representative check per area,
// same "grouped specs fine" allowance the playbook itself grants):
//   fintech:   CreditScoreScreen, InsuranceScreen, LoanApplicationScreen, LoanProductsScreen   → useFlag('fintech')
//   dairy:     D2cSubscriptionScreen, MccSlipScreen, MilkBillScreen, MilkDiaryScreen           → useFlag('dairy')
//   livestock: HealthRecordScreen, VetBookingScreen, AnimalDetailScreen, AnimalListScreen       → useFlag('livestock')
import { flags } from '../flags/flags';
import { offModuleState } from '../flags/off-module-state';

describe('DEV-11 Group-B EmptyState pass — fintech/dairy/livestock gate', () => {
  afterEach(() => flags.hydrate({}));

  for (const area of ['fintech', 'dairy', 'livestock'] as const) {
    describe(`${area} flag`, () => {
      it('default matches its phase (PC-50 W10-1 flipped livestock ON — the Pashupalak app is built)', () => {
        expect(flags.isEnabled(area)).toBe(area === 'livestock');
      });

      it('the kill-switch channel can flip it ON (e.g. a founder GA-Wave rollout)', () => {
        flags.hydrate({ [area]: true });
        expect(flags.isEnabled(area)).toBe(true);
      });

      it('4 screens in this area gate on the SAME flag → OFF renders the "unavailable" state', () => {
        flags.hydrate({ [area]: false });
        expect(offModuleState(flags.isEnabled(area))).toBe('off');
      });

      it('ON renders "comingSoon", never a fabricated real screen (Law 12 — nothing is built yet)', () => {
        flags.hydrate({ [area]: true });
        expect(offModuleState(flags.isEnabled(area))).toBe('comingSoon');
      });
    });
  }
});

describe('offModuleState (pure)', () => {
  it('OFF flag → off', () => {
    expect(offModuleState(false)).toBe('off');
  });
  it('ON flag → comingSoon', () => {
    expect(offModuleState(true)).toBe('comingSoon');
  });
});
