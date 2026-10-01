// apps/web-tenant/src/app/content/banners/new/page.tsx · the banners-form chain — W2510 form-error · W2511 review · W2512
// success · W2513 failure (*"New banner"*, from W173) · PC-56 TENANT-8d. One screen with the banner-form chain
// (`components/BannerFormScreen.tsx`). A new banner is born a DRAFT; activating it is the mutate chain's act.
import type { Metadata } from 'next';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { NEW_BANNER_HREF } from '../../../../features/banners/banners';
import { BannerFormScreen } from '../../../../components/BannerFormScreen';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('form.banner.title.banners'), robots: { index: false, follow: false } }; }

export default async function NewBannerPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_BANNER_HREF);
  return <BannerFormScreen chain="banners" searchParams={searchParams} />;
}
