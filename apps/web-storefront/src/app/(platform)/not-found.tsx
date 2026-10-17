// apps/web-storefront/src/app/(platform)/not-found.tsx · PC-56 STORE-SWEEP-b · C2 (founder D4 — canon W316 "not-found") — a `notFound()` from a
// PLATFORM page renders inside the platform's own chrome (`(platform)/layout.tsx`): the three questions' words and "Back to the bazaar" → `/`.
import { BoundaryView } from '../../components/sweep/BoundaryView';

export default function PlatformNotFound() {
  return <BoundaryView kind="not_found" />;
}
