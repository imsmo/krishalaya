// apps/mobile/src/core/mechanisms/useSplitLayout.ts · DEV-20: the hook a list-type farmer screen calls to know
// whether to render the APPLY-9/Q49 tablet two-pane master-detail layout. Wraps the pure `isEligibleForSplit`
// (splitLayout.ts) with RN's live window width + a best-effort pointer-type read.
//
// DEV-26/Q17 test-coverage note: every existing screen-level render-spec that touches this hook
// (`dev20-split-screens.render-spec.tsx`) `jest.mock()`s this whole module away — correct for a SCREEN test (it
// shouldn't re-verify the mechanism), but it meant `readIsCoarsePointer`'s own branching was never itself
// exercised anywhere. Made non-private (was unexported) purely so
// `dev26-pointer-detection.render-spec.tsx` can call the REAL implementation directly and close that gap — no
// behavior change, a visibility change only.
import { useMemo } from 'react';
import { useWindowDimensions, Platform } from 'react-native';
import { isEligibleForSplit, splitListColumnWidth, SPLIT_MAX_WIDTH_PX } from './splitLayout';

export interface UseSplitLayoutResult {
  /** True when this screen should render its `.screen-split`-equivalent two-pane body. */
  isSplit: boolean;
  listColumnWidth: number;
  maxWidth: number;
}

/** Best-effort "is this a coarse (touch) pointer" read. Every native (iOS/Android) surface is a real touchscreen —
 * `pointer:coarse` in canon terms — so this returns true there unconditionally (RN has no pointer-media API to
 * query, and there is no other real signal). Only on Expo Web (`Platform.OS === 'web'`) does a `pointer:fine`
 * desktop browser genuinely exist, so there we ask the DOM directly (`window.matchMedia`), exactly mirroring the
 * canon's own `(pointer: coarse)` gate — a resized desktop window does NOT get the tablet treatment, same as the
 * web canon's own documented, deliberate choice. Never throws on a matchMedia-less environment (SSR/test). */
export function readIsCoarsePointer(): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    const w = globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } };
    if (typeof w.matchMedia !== 'function') return true;
    return w.matchMedia('(pointer: coarse)').matches;
  } catch {
    return true;
  }
}

export function useSplitLayout(): UseSplitLayoutResult {
  const { width } = useWindowDimensions();
  const isSplit = useMemo(() => isEligibleForSplit(width, readIsCoarsePointer()), [width]);
  return { isSplit, listColumnWidth: splitListColumnWidth(), maxWidth: SPLIT_MAX_WIDTH_PX };
}
