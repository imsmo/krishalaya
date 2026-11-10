// apps/web-gov/src/app/canon/chrome/page.tsx · PC-56 GOV-1b — W358 (`/canon/chrome`, linked from the console's footer, not the sidebar) and its
// chain W3214–W3216 as `?act=` states (PARITY-DECOR: the page loads no theme file, so its "Retry" is a re-read; Back → /canon/chrome). Gated
// by requireGov (E2): the rules name the signed-in authority. Reads nothing else. noindex.
import type { Metadata } from 'next';
import { requireGov } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { ChromeCanonView } from '../../../components/gov1/DashboardViews';
import { Gov1Chain } from '../../../components/gov1/Gov1Chain';
import { chain1State } from '../../../features/gov1/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov1.chrome.title'), robots: { index: false, follow: false } };
}

export default async function ChromeCanonPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requireGov('/canon/chrome');
  const t = getTranslator();
  const act = chain1State('chrome_reread', searchParams);
  if (act) return <Gov1Chain t={t} chain="chrome_reread" state={act} />;
  return <ChromeCanonView t={t} me={me} />;
}
