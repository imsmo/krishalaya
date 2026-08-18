// apps/web-admin/src/middleware.ts · DEV-61 (UI Port Program batch 4, shell adoption). NEW FILE — this app had
// no middleware before this batch (grep-verified). Its ONLY job: forward the request's own pathname as a
// request header (`x-pathname`) so `layout.tsx` (a Server Component, which cannot call the client-only
// `usePathname()` hook) can read it via `next/headers`' `headers()` and mark the active `Sidebar` nav item with
// real `aria-current="page"` — canon's own `.kvw-nav-item a[aria-current="page"]` highlight (background +
// left accent bar, `web-frame.css` lines 77-86) is one of the most visually obvious details on every real
// canon admin screen, and the pre-existing web-admin `Sidebar` had NO active-item detection at all (confirmed
// by grep before this batch: zero `aria-current`/`usePathname` anywhere in `components/Sidebar.tsx`) — so this
// is a genuine capability being ADDED here, not "preserved" from a working prior state (disclosed in
// spec_dev61.md). This mirrors the exact, standard Next.js App Router pattern for giving a Server Component
// layout access to the current path; it changes NOTHING else about the request (no redirect, no rewrite, no
// auth decision — `requireAdmin()`/`isAdminAuthenticated()` remain the only gates, unaffected by this file).
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

// Excludes static assets/image-optimizer/favicon — this header is only ever read for page navigations.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
