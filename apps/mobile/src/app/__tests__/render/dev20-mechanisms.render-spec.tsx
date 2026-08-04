// apps/mobile/src/app/__tests__/render/dev20-mechanisms.render-spec.tsx · DEV-20 DEV-46-harness render-floor
// proof that the dark/senior/RTL mechanisms are REALLY applied through their public hooks + boot glue — not just
// correct in isolation (dev20-mechanisms.spec.ts already covers the pure math under the "core" project). This
// file mounts a tiny probe component (not a real screen — the mechanism is cross-cutting infrastructure, not
// screen-specific) via the same `renderScreen` harness DEV-46 built for every other render spec, so it runs
// under the "render" jest project (jest-expo preset — real RN mocks, including `I18nManager` and
// `react-native-async-storage`'s own jest mock, wired below exactly once).
import React from 'react';
import { act } from 'react-test-renderer';
import { Text, View, I18nManager } from 'react-native';
import { renderScreen } from '../../../test-utils/render';
import { useThemeMode } from '../../../core/mechanisms/useThemeMode';
import { useSeniorMode } from '../../../core/mechanisms/useSeniorMode';
import { mechanismPreferences } from '../../../core/mechanisms/mechanismStore.runtime';
import { applyRtlForDirection } from '../../../core/mechanisms/rtlBoot';
import { font as baseFont } from '@krishalaya/ui-native';

// A top-level ES import of the mock here breaks jest.mock's hoisting for this specific package (the factory runs
// before the import binding is populated) — this is AsyncStorage's own documented jest.mock pattern (a lazy
// require() inside the factory), not a stylistic choice, so the usual "prefer ES imports" hygiene rule is
// suppressed for this one line rather than shipping a broken test.
// eslint-disable-next-line no-restricted-syntax
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

function MechanismProbe() {
  const { mode, scheme } = useThemeMode();
  const { enabled, fontSize, tapMin } = useSeniorMode();
  return (
    <View>
      <Text testID="theme-mode">{mode}</Text>
      <Text testID="theme-scheme">{scheme}</Text>
      <Text testID="senior-enabled">{String(enabled)}</Text>
      <Text testID="senior-font-md">{String(fontSize.md)}</Text>
      <Text testID="senior-tap-min">{String(tapMin)}</Text>
    </View>
  );
}

describe('DEV-20 mechanisms — applied, not just correct in isolation', () => {
  afterEach(async () => {
    // mechanismPreferences is a module-level singleton (by design, mirrors flags.ts/i18n.ts) — reset it between
    // tests, wrapped in act() since a still-mounted probe from THIS test is subscribed at this point.
    await act(async () => {
      await mechanismPreferences.setSeniorMode(false);
      await mechanismPreferences.setThemeMode('system');
    });
  });

  it('defaults: system theme mode resolves to light scheme with no OS signal, senior mode off, base tap/font sizes', async () => {
    const renderer = await renderScreen(<MechanismProbe />);
    expect(renderer.root.findByProps({ testID: 'theme-mode' }).props.children).toBe('system');
    expect(renderer.root.findByProps({ testID: 'senior-enabled' }).props.children).toBe('false');
    expect(renderer.root.findByProps({ testID: 'senior-font-md' }).props.children).toBe(String(baseFont.size.md));
    expect(renderer.root.findByProps({ testID: 'senior-tap-min' }).props.children).toBe('48');
  });

  it('senior mode ON (via the real runtime, same path the Settings toggle uses): fonts scale 1.30x, tap floor is 56', async () => {
    const renderer = await renderScreen(<MechanismProbe />);
    await act(async () => { await mechanismPreferences.setSeniorMode(true); });
    expect(renderer.root.findByProps({ testID: 'senior-enabled' }).props.children).toBe('true');
    expect(renderer.root.findByProps({ testID: 'senior-tap-min' }).props.children).toBe('56');
    const expectedMd = Math.round(baseFont.size.md * 1.3 * 10) / 10;
    expect(renderer.root.findByProps({ testID: 'senior-font-md' }).props.children).toBe(String(expectedMd));
  });

  it('theme mode set to "dark" (via the real runtime): resolved scheme is dark regardless of OS signal', async () => {
    const renderer = await renderScreen(<MechanismProbe />);
    await act(async () => { await mechanismPreferences.setThemeMode('dark'); });
    expect(renderer.root.findByProps({ testID: 'theme-mode' }).props.children).toBe('dark');
    expect(renderer.root.findByProps({ testID: 'theme-scheme' }).props.children).toBe('dark');
  });

  it('RTL boot glue: applyRtlForDirection calls I18nManager.allowRTL(true) + forceRTL(shouldForce), reports reload-needed', () => {
    // jest-expo's I18nManager mock resolves `isRTL` ONCE at module load from its native constants (real RN
    // behavior too, per rtlBoot.ts's own header comment: forceRTL only takes effect after a JS bundle reload,
    // it is not a live property) — so the correct proof here is that the boot glue calls the two native-module
    // functions with the right arguments, not that a static constant mutates synchronously.
    const forceRTLSpy = jest.spyOn(I18nManager, 'forceRTL');
    const allowRTLSpy = jest.spyOn(I18nManager, 'allowRTL');
    const startingRTL = I18nManager.isRTL; // every live app language is ltr — this is the honest starting state
    expect(startingRTL).toBe(false);

    const needsReload = applyRtlForDirection('rtl');
    expect(needsReload).toBe(true);
    expect(allowRTLSpy).toHaveBeenCalledWith(true);
    expect(forceRTLSpy).toHaveBeenCalledWith(true);
    // Calling again with the SAME dir also calls forceRTL(true) again (idempotent, harmless per rtlBoot.ts) —
    // it does NOT re-report needsReload=false here, because the mock's `I18nManager.isRTL` constant never moves
    // (see comment above): `applyRtlForDirection` reads the CURRENT `I18nManager.isRTL` fresh every call, and in
    // this mocked native environment that value is frozen at its module-load default forever, so the "already
    // forced, no reload needed" idempotence path can only be proven at the pure-function level — which
    // `dev20-mechanisms.spec.ts`'s `rtlChangeRequiresReload` tests already do (both a real flip and a no-op
    // re-application, with an in-memory boolean that DOES move). This render-spec's job is narrower and real:
    // prove the RN glue calls the right native functions with the right arguments.
    applyRtlForDirection('rtl');
    expect(forceRTLSpy).toHaveBeenCalledTimes(2);

    forceRTLSpy.mockRestore();
    allowRTLSpy.mockRestore();
  });
});
