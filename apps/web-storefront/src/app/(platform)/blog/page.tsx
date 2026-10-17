// apps/web-storefront/src/app/(platform)/blog/page.tsx · "Blog" index. PC-56 STORE-SWEEP-a (survey C-3): the SDK has carried a CMS resource since
// TENANT-8c, but there is NO anonymous published-only read (pages are behind AuthGuard + the `cms` flag, OFF) and nothing writes platform pages
// (B4, named) — so this renders a localized empty state rather than faking posts. Platform-only: a store's own host answers 307 to the platform.
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
