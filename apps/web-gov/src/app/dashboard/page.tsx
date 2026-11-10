// apps/web-gov/src/app/dashboard/page.tsx · PC-56 GOV-1a — /dashboard until GOV-1b builds W325 (the scheme portfolio, on its own overview read).
// The pre-canon page read the organisation sign-in's `auth.me` and printed a static "Live" table of five areas that were not live, with
// internal file names (survey C-4, C-5). Under a government authority's session it is gated (requireGov, E2) and says ONE true sentence: it
// is being rebuilt for authorities in a later wave, and it reads nothing. The old /schemes, /registers, /verification, /mgnrega addresses
// 307 here (next.config.js).
import type { Metadata } from 'next';
import { requireGov } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { RebuiltLater } from '../../components/gov1/GovShell';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dash.title'), robots: { index: false, follow: false } };
}

export default async function DashboardPage() {
  await requireGov('/dashboard');
  return <RebuiltLater t={getTranslator()} />;
}
