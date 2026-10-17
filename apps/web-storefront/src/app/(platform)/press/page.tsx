// apps/web-storefront/src/app/(platform)/press/page.tsx · PC-56 STORE-SWEEP-a · C2 (survey F-9; founders D5 / D7) — PRESS, PLATFORM-ONLY (a store host
// answers 307 to the platform's origin). Reworded: no "we'll respond within two business days" (no reply time is promised) and no channel that does
// not exist — the press mailbox is the platform-facts read (migration 0223), printed when set, "not published yet" when empty, the error said when
// the read fails. No canon file (outside the panel's census).
import type { Metadata } from 'next';
import type { PlatformFacts } from '@krishalaya/sdk-js';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { loadResult, reloadHref } from '../../../features/home/load-result';
import { factLine } from '../../../features/sweep/facts';
import { FactItem, FactsError } from '../../../components/sweep/Facts';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('press.title'), description: t.t('press.lead') };
}

export default async function PressPage() {
  const t = getTranslator();
  const facts = await loadResult<PlatformFacts>(() => publicClient().storefront.platformFacts());
  return (
    <article className="kv-prose" data-kv-press="">
      <h1>{t.t('press.title')}</h1>
      <p className="kv-prose__lead">{t.t('press.lead')}</p>
      <p>{t.t('press.body')}</p>
      <h2>{t.t('press.contact')}</h2>
      {facts.ok
        ? <ul className="kv-facts"><FactItem id="mailbox.press" label={t.t('sweep.fact.mailbox.press')} line={factLine(facts.data.contact.pressEmail)} /></ul>
        : <FactsError retryHref={reloadHref('/press')} />}
      <p><a href="/contact" className="kv-btn--link" data-kv-link="contact">{t.t('help.link.contact')}</a></p>
    </article>
  );
}
