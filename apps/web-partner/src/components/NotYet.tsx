// apps/web-partner/src/components/NotYet.tsx · PC-56 PARTNER-0 · founder D8 — the ONE honest state of a page that has no partner read yet
// (features/partner/not-yet.ts lists them). Presentational: no fetch, no cookies, no tenant call — it renders the same in a page and in the
// render test. All copy via i18n; no inline styles.
import Link from 'next/link';
import { notYetSurface, surfaceKey } from '../features/partner/not-yet';

export interface Tr { t(key: string, vars?: Record<string, string | number>): string }

export function notYetTitle(t: Tr, route: string): string {
  const s = notYetSurface(route);
  return t.t('partner.notYet.title', { surface: s ? t.t(surfaceKey(s)) : route });
}

export function NotYet({ t, route }: { t: Tr; route: string }) {
  return (
    <section className="kv-notyet" data-not-yet={notYetSurface(route) ?? 'unknown'}>
      <h1>{notYetTitle(t, route)}</h1>
      <p className="kv-muted">{t.t('partner.notYet.body')}</p>
      <p className="kv-pager"><Link className="kv-btn" href="/loan-queue">{t.t('partner.notYet.back')}</Link></p>
    </section>
  );
}
