// apps/web-tenant/src/app/content/faq/new/page.tsx · the faq-form chain — W2605 form-error · W2606 review · W2607 success
// · W2608 failure (*"New FAQ entry · New entry"*, from W177) · PC-56 TENANT-8c. An FAQ entry IS a page (`page_kind =
// faq`): the question is its title, the answer its body, its topic from the vocabulary, its place the last in that topic.
import type { Metadata } from 'next';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { NEW_FAQ_HREF } from '../../../../features/pages/pages';
import { PageFormScreen } from '../../../../components/PageFormScreen';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('form.page.title.faq'), robots: { index: false, follow: false } }; }

export default async function NewFaqPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_FAQ_HREF);
  return <PageFormScreen chain="faq" searchParams={searchParams} />;
}
