// apps/mobile/src/core/flags/off-module-state.ts · pure decision helper for a Group-B genuine-gap module's screens
// (DEV-11: fintech/dairy/livestock, DEV-08 census §2 "genuine gap" — no route group, no built content anywhere).
// Framework-free by design (Law 9 / HARD RULE: this repo's jest.config.js only executes src/core/__tests__/*.spec.ts
// as pure Node logic — RN component rendering is out of that config's scope, see its own header comment — so the
// gating DECISION a screen makes is factored out here where it's actually testable, instead of living un-testably
// inline in 12 near-identical .tsx files).
//
// Both states render the SAME EmptyState component, never fabricated content (Law 12): the module has nothing
// built yet regardless of the flag's value, so even a hypothetical ops flip to ON must not pretend a screen exists.
// 'off'        — flag OFF (the pilot default, master-plan §2.2 rows 2/4/5): "this section is temporarily unavailable"
// 'comingSoon' — flag ON (a founder/ops flip ahead of the real GA-Wave-2/3 build landing): an honest "on the way"
//                notice, never a fake confident screen.
export type OffModuleState = 'off' | 'comingSoon';

export function offModuleState(flagEnabled: boolean): OffModuleState {
  return flagEnabled ? 'comingSoon' : 'off';
}
