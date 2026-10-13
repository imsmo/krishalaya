// apps/web-storefront/src/app/(platform)/about/page.tsx · static "About" page. Server-rendered, localized copy from the
// i18n catalogs (no SDK call — there is no CMS resource in the SDK, so marketing copy is static per the backlog's
// "else static copy" branch). Per-request metadata is localized too.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('about.title'), description: t.t('about.lead') };
}

export default function AboutPage() {
  const t = getTranslator();
  return (
    <article className="kv-prose">
      <h1>{t.t('about.title')}</h1>
      <p className="kv-prose__lead">{t.t('about.lead')}</p>
      <p>{t.t('about.p1')}</p>
      <p>{t.t('about.p2')}</p>
      <h2>{t.t('about.missionTitle')}</h2>
      <p>{t.t('about.mission')}</p>
    </article>
  );
}
