// apps/web-storefront/src/app/(platform)/language/page.tsx · PC-56 STORE-SWEEP-b · C2 (founder D3 — canon W323) — the language page under the PLATFORM's
// chrome. `from` = the link's `?from=`, else the Referer when it is this same host, else `/` (features/sweep/languages.ts `languageFrom`). No flag
// (choosing a language is never switched off — the 4c "ONE language" rule; the 0223 Law 10 exception for information pages). `language` is a
// reserved slug since 0204:149.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getLang, getTranslator } from '../../../lib/i18n';
import { LanguageScreen } from '../../../components/sweep/LanguageScreen';
import { PLATFORM_CHROME } from '../../../features/store4a/account';
import { languageFrom } from '../../../features/sweep/languages';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('sweep.language.title'), robots: { index: false, follow: true } };
}

export default function PlatformLanguagePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const h = headers();
  const from = languageFrom(searchParams.from, h.get('referer'), h.get('host'), '/');
  return <LanguageScreen chrome={PLATFORM_CHROME} from={from} active={getLang()} />;
}
