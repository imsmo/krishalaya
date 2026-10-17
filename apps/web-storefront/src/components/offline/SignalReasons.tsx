'use client';
// apps/web-storefront/src/components/offline/SignalReasons.tsx · PC-56 STORE-6a · D1 — the storefront-local half of "— needs signal": WHY, in
// words. Mounted once in each chrome BESIDE the drift-pinned port (components/OnlineGuard.tsx, untouched): it watches the page — the port's
// banner appearing, the port's `data-kv-signal="held"` marks — and runs features/store6/signal-words.ts `applyReasons`, which prints the reason
// beside every held money / countdown form and holds (and words) the standalone Pay button. Renders nothing itself.
import { useEffect } from 'react';
import { applyReasons } from '../../features/store6/signal-words';

export function SignalReasons({ words, needsSignal }: { words: Record<string, string>; needsSignal: string }) {
  useEffect(() => {
    const run = () => { applyReasons(document as never, words, needsSignal); };
    run();
    const obs = new MutationObserver(run);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-kv-signal'] });
    return () => obs.disconnect();
  }, [words, needsSignal]);
  return null;
}
