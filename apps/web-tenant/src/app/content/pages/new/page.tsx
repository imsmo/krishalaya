// apps/web-tenant/src/app/content/pages/new/page.tsx · the pages-form chain — W2703 form-error · W2704 review · W2705
// success · W2706 failure (*"New page"*, from W175) · PC-56 TENANT-8c. One screen with the page-form and faq-form chains
// (`components/PageFormScreen.tsx`); `?slug=` aims it at a slug only the platform has — writing your own version of a
// platform page, which W175 says *"replace[s] them as you publish"*.
import type { Metadata } from 'next';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { NEW_PAGE_HREF } from '../../../../features/pages/pages';
import { PageFormScreen } from '../../../../components/PageFormScreen';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('form.page.title.pages'), robots: { index: false, follow: false } }; }

export default async function NewPagePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_PAGE_HREF);
  return <PageFormScreen chain="pages" searchParams={searchParams} />;
}
