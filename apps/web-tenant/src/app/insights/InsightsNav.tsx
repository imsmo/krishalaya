// apps/web-tenant/src/app/insights/InsightsNav.tsx · PC-56 TENANT-SW-f — the Insights sub-nav the canon draws on W193–W196:
// Mandi Pulse · Demand map · Wastage · Reports. (The AGM pack, SW-d, lives under /insights/governance and is reached from Governance.)
import Link from 'next/link';
import type { Translator } from '@krishalaya/i18n';
import { INSIGHT_TABS } from '../../features/swf/console';

export function InsightsNav({ t, active }: { t: Translator; active: (typeof INSIGHT_TABS)[number]['key'] }) {
  return (
    <nav className="kv-tabs" aria-label={t.t('swf.nav.label')}>
      {INSIGHT_TABS.map((x) => (
        <Link key={x.key} href={x.href} className={x.key === active ? 'kv-tab kv-tab--active' : 'kv-tab'} aria-current={x.key === active ? 'page' : undefined}>{t.t(`swf.nav.${x.key}`)}</Link>
      ))}
    </nav>
  );
}
