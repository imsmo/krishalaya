// apps/web-tenant/src/components/ConsoleTopbar.tsx · DEV-18 REAL consuming-app smoke test (packages/ui
// port batch 4). Wraps `@krishi-verse/ui`'s `Topbar` for the console shell. `me` is passed down from
// `layout.tsx` (fetched once there, shared with `Sidebar`'s `tenant` slot — see that file's own header
// comment for why).
//
// HONEST BOUNDARY (disclosed, not silently absorbed — see `dev18_report.md`): this app has no real search
// implementation or notification-unread-count data source today (grep-verified: no such endpoint is called
// anywhere in `src/lib/api-client.ts`), so `Topbar`'s `search`/`notification` slots are left EMPTY here
// rather than fabricated with fake placeholder behavior (Golden Law 12 — a disclaimed value must still be
// real; inventing a "0 unread" badge with no backing data would be worse than showing no bell at all).
// `userMenu` shows only the real, already-fetched display name — no invented avatar-initials scheme (per
// `Avatar`'s own header comment: never guess initials from a name split).
import type { UserProfile } from '@krishi-verse/sdk-js';
import { Topbar } from '@krishi-verse/ui';

export function ConsoleTopbar({ me }: { me: UserProfile | null }) {
  return (
    <Topbar
      userMenu={<span className="kv-muted">{me?.displayName ?? me?.id ?? '—'}</span>}
    />
  );
}
