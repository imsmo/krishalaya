// apps/web-tenant/src/app/content/pages/[slug]/edit/page.tsx · the page-form chain — W2696 form-error · W2697 review ·
// W2698 success · W2699 failure (*"Choose kind"* — the editor's chain on a slug) · PC-56 TENANT-8c. The open draft is
// edited if one waits; otherwise this writes the slug's next version (the review says which, and the version number).
// The kind is the slug's once it has a version (a policy page re-filed as `static` would drop its checker).
import type { Metadata } from 'next';
import { requireSession } from '../../../../../lib/session';
import { getTranslator } from '../../../../../lib/i18n';
import { editPageHref } from '../../../../../features/pages/pages';
import { PageFormScreen } from '../../../../../components/PageFormScreen';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('form.page.title.page'), robots: { index: false, follow: false } }; }

export default async function EditPagePage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const slug = decodeURIComponent(params.slug);
  await requireSession(editPageHref(slug));
  return <PageFormScreen chain="page" slug={slug} searchParams={searchParams} />;
}
