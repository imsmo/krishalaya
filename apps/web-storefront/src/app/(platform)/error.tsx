'use client';
// apps/web-storefront/src/app/(platform)/error.tsx · PC-56 STORE-SWEEP-b · C2 (founder D4 — canon W316 "server") — a PLATFORM page that fails stays in
// the platform's chrome (the root `app/error.tsx` renders outside it). The same words and rule as a store's: a Try-again button, never an automatic retry.
import { BoundaryView } from '../../components/sweep/BoundaryView';

export default function PlatformError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <BoundaryView kind="error" code={error?.digest ?? null} onRetry={reset} />;
}
