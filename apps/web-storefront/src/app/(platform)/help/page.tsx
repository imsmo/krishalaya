// apps/web-storefront/src/app/(platform)/help/page.tsx · PC-56 STORE-SWEEP-a · C2 (canon W311; founder D8) — Help under the PLATFORM chrome. The
// SHARED screen (components/sweep/HelpScreen.tsx): on the platform both money cases are printed (no store's flag decides here). It replaced the
// static four-answer page whose money, tracking and support answers were false (survey F-2). No flag (0223's named Law 10 exception).
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { HelpScreen } from '../../../components/sweep/HelpScreen';
import { PLATFORM_CHROME } from '../../../features/store4a/account';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('help.title'), description: t.t('help.lead') };
}

export default function HelpPage() {
  return <HelpScreen chrome={PLATFORM_CHROME} flags={null} />;
}
