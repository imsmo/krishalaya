// apps/web-tenant/src/app/content/banners/[id]/edit/page.tsx · the banner-form chain — W2503 form-error · W2504 review ·
// W2505 success · W2506 failure (*"Add gu variant · Save changes"*, W174's chain) · PC-56 TENANT-8d. Both canon acts are
// this one write: adding the gu words IS saving the banner with them (one banner, one row per language — 0178).
import type { Metadata } from 'next';
import { requireSession } from '../../../../../lib/session';
import { getTranslator } from '../../../../../lib/i18n';
import { editBannerHref } from '../../../../../features/banners/banners';
import { BannerFormScreen } from '../../../../../components/BannerFormScreen';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('form.banner.title.banner'), robots: { index: false, follow: false } }; }

export default async function EditBannerPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const id = decodeURIComponent(params.id);
  await requireSession(editBannerHref(id));
  return <BannerFormScreen chain="banner" id={id} searchParams={searchParams} />;
}
