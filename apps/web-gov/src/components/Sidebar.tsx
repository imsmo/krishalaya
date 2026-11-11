// apps/web-gov/src/components/Sidebar.tsx · the government console's nav (PC-56 GOV-1a). A server wrapper: it binds the request's translator
// and language and the locale switcher to the presentational `GovSidebar` (components/gov1/GovShell.tsx, render-tested), which names the
// AUTHORITY the API says this session is in and links only to the routes GOV-1a builds. Drawn by the layout ONLY for a verified gov session.
import type { GovMe } from '@krishalaya/sdk-js';
import { getTranslator, getLang } from '../lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { GovSidebar } from './gov1/GovShell';

export function Sidebar({ me }: { me: GovMe }) {
  const t = getTranslator();
  return <GovSidebar t={t} me={me} switcher={<LocaleSwitcher active={getLang()} label={t.t('lang.label')} draftLabel={t.t('lang.draft')} />} />;
}
