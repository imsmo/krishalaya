// apps/web-storefront/src/app/(platform)/blog/page.tsx · "Blog" index. There is NO CMS resource in the SDK yet, so this
// renders a localized empty state rather than faking posts (no stubs — backlog "else static copy"). When a CMS
// content resource lands in the SDK, this page lists posts through it; the empty state is the honest interim.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('blog.title'), description: t.t('blog.lead') };
}

export default function BlogPage() {
  const t = getTranslator();
  return (
    <article className="kv-prose">
      <h1>{t.t('blog.title')}</h1>
      <p className="kv-prose__lead">{t.t('blog.lead')}</p>
      <p className="kv-empty">{t.t('blog.empty')}</p>
    </article>
  );
}
