// apps/web-gov/src/features/nav/safe-next.ts · PURE same-origin return-path guard (open-redirect protection),
// shared by the session gate and login redirects. No framework, no I/O → unit-tested. Only a path that starts
// with a single '/' is honoured; anything else (absolute URLs, protocol-relative '//evil', junk) collapses to a
// safe default.
export function safeNext(next: string | undefined | null, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
