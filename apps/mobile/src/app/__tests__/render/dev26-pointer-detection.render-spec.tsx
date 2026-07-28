// apps/mobile/src/app/__tests__/render/dev26-pointer-detection.render-spec.tsx · DEV-26, Q17 (pointer:coarse
// detection). Closes the one real test gap found for the already-shipped DEV-19 (web)/DEV-20 (mobile) mechanism:
// `useSplitLayout`'s `readIsCoarsePointer()` branching was NEVER itself exercised — every screen-level render-spec
// mocks `useSplitLayout` away entirely (correctly, for a screen test), leaving this one small function untested.
// Runs under the "render" jest project (RN mocked) since `readIsCoarsePointer` imports `Platform` from
// 'react-native' — it cannot run under the "core" project's plain-node environment.
import { Platform } from 'react-native';
import { readIsCoarsePointer } from '../../../core/mechanisms/useSplitLayout';

describe('readIsCoarsePointer (DEV-19/DEV-20 mechanism, Q17 pointer:coarse — real logic, not mocked)', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    delete (globalThis as any).matchMedia;
  });

  it('every native surface (iOS/Android) is treated as a real touchscreen — always coarse, RN has no pointer-media API', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    expect(readIsCoarsePointer()).toBe(true);
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    expect(readIsCoarsePointer()).toBe(true);
  });

  it('Expo Web with no matchMedia available degrades to coarse (never silently loses the mechanism)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    delete (globalThis as any).matchMedia;
    expect(readIsCoarsePointer()).toBe(true);
  });

  it('Expo Web asks the DOM directly and honors a real fine-pointer desktop browser result', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    (globalThis as any).matchMedia = (q: string) => ({ matches: q.includes('coarse') ? false : true });
    expect(readIsCoarsePointer()).toBe(false);
  });

  it('Expo Web honors a real coarse-pointer (touch laptop/tablet browser) result', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    (globalThis as any).matchMedia = () => ({ matches: true });
    expect(readIsCoarsePointer()).toBe(true);
  });

  it('Expo Web degrades to coarse if matchMedia itself throws (never crashes a render path, Law 12)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    (globalThis as any).matchMedia = () => { throw new Error('no window'); };
    expect(readIsCoarsePointer()).toBe(true);
  });
});
