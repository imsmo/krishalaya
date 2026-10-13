// apps/web-storefront/src/app/(platform)/press/page.tsx · static "Press" page. Localized copy; no SDK call.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('press.title'), description: t.t('press.lead') };
}

export default function PressPage() {
  const t = getTranslator();
  return (
    <article className="kv-prose">
      <h1>{t.t('press.title')}</h1>
      <p className="kv-prose__lead">{t.t('press.lead')}</p>
      <p>{t.t('press.body')}</p>
      <h2>{t.t('press.contact')}</h2>
    </article>
  );
}
