// apps/web-tenant/src/app/dashboard/page.tsx · console home. Server-gated (requireSession, async w/ silent
// refresh) and greets the authenticated staff member from /auth/me. If the profile call fails the page still
// renders (Law 12). All copy via i18n; noindex (inherited from layout).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator } from '../../lib/i18n';
import type { UserProfile } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic'; // per-request (session-scoped); never statically cached

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dashboard.title'), robots: { index: false, follow: false } };
}

export default async function DashboardPage() {
  await requireSession('/dashboard');
  const t = getTranslator();
  let me: UserProfile | null = null;
  try { me = await tenantClient().auth.me(); } catch { me = null; }

  const cards = [
    { href: '/listings', label: t.t('dashboard.manageListings') },
    { href: '/orders', label: t.t('dashboard.viewOrders') },
  ];

  return (
    <section>
      <h1>{t.t('dashboard.title')}</h1>
      <p className="kv-muted">
        {me ? t.t('dashboard.greeting', { name: me.displayName ?? me.id, roles: (me.roles ?? []).join(', ') }) : t.t('dashboard.welcome')}
      </p>
      <div className="kv-cards">
        {cards.map((c) => <Link key={c.href} href={c.href} className="kv-card">{c.label} →</Link>)}
      </div>
    </section>
  );
}
