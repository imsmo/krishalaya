// apps/mobile/src/test-utils/render.ts · DEV-46 thin render-floor harness. Wraps `react-test-renderer` (already
// resolved in pnpm-lock.yaml as a transitive dep of jest-expo pre-DEV-46; promoted to a direct devDependency this
// batch — see apps/mobile/package.json, zero new external package added) so every render spec calls one function
// instead of repeating the `act()` boilerplate. `renderScreen` awaits one microtask/macrotask tick after mount so
// a screen's `useEffect`/`useFocusEffect`-triggered data-load (mocked feature APIs resolve immediately) has a
// chance to settle and re-render before the assertion runs — without this, list screens would still show their
// initial loading skeleton, never their empty/loaded state.
//
// Auto-unmount: several screens (wallet, listings) render `SkeletonCard`, which starts an infinite
// `Animated.loop` pulse. Left mounted past test-end, its rescheduled timers fire after Jest tears the test
// environment down ("Cannot log after tests are done" / "trying to access ... after it has been torn down").
// Every renderer this module creates is tracked and unmounted in a module-level `afterEach`, so this is handled
// once, centrally, instead of every spec file remembering to call `.unmount()` itself.
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactElement } from 'react';

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  while (mounted.length) {
    const renderer = mounted.pop()!;
    act(() => { renderer.unmount(); });
  }
});

/** Mount `element`, flush one tick of pending microtasks (mocked API promises + their setState), and return the
 * renderer. Render-and-basic-assertion floor only (contract-scoped) — this is NOT an interaction harness; no
 * fireEvent/user-input helper is provided on purpose (DEV-46 scope: renders-without-throwing + one state
 * assertion per screen, not full interaction testing). */
export async function renderScreen(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
    await flushMicrotasks();
  });
  mounted.push(renderer);
  return renderer;
}

/** Let queued promise `.then()` chains (Promise.all + setState from a mocked API resolving immediately) run
 * before the next assertion. Two ticks covers the common `Promise.all([...]).then(setState)` shape used across
 * every screen read in this batch. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise((resolve) => setTimeout(resolve, 0)));
}
