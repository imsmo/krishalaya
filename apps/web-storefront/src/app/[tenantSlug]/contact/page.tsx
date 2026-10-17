// apps/web-storefront/src/app/[tenantSlug]/contact/page.tsx · PC-56 STORE-SWEEP-a · C2 (founder D6) — A STORE'S OWN CONTACT PAGE, under the
// organisation's chrome (`/contact` on its own host). Two reads: the store's shell (its name — React-cached, shared with the layout) and its public
// flags (`communication` decides the "Message the organisation" doors; unreadable → said so). The Grievances link is the platform's trust page — on
// the store's own host on the platform's origin (the layout's rule: `NEXT_PUBLIC_SITE_URL` only when the request was host-routed).
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { StorefrontFlags } from '@krishalaya/sdk-js';
import { env } from '../../../lib/env';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { loadTenantShell } from '../../../lib/storefront-data';
import { TENANT_SLUG_HEADER } from '../../../lib/host-routing';
import { StoreContactScreen, messagesState } from '../../../components/sweep/StoreContactScreen';
import { tenantChrome } from '../../../features/store4a/account';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('sweep.contact.title'), description: t.t('sweep.storeContact.lead') };
}

export default async function TenantContactPage({ params }: { params: { tenantSlug: string } }) {
  const slug = params.tenantSlug;
  const shell = await loadTenantShell(slug);
  const b = shell.kind === 'ok' ? shell.branding : null;
  const name = (b?.brand?.displayName || b?.displayName || (shell.kind === 'ok' ? shell.tenant.displayName : '') || slug).trim();
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  const platformOrigin = headers().get(TENANT_SLUG_HEADER) === slug ? env.siteUrl : '';
  return <StoreContactScreen chrome={tenantChrome(slug)} name={name} messages={messagesState(flags)} platformOrigin={platformOrigin} />;
}
