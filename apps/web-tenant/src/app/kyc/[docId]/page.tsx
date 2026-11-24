// apps/web-tenant/src/app/kyc/[docId]/page.tsx · PC-56 TENANT-SW-c · one document moved to its canon path — W158
// `/people/verification/[id]`. Old deep links redirect.
import { redirect } from 'next/navigation';
import { docHref } from '../../../features/kyc/desk';

export const dynamic = 'force-dynamic';

export default async function KycDocumentMoved(props: { params: Promise<{ docId: string }> }) {
  const params = await props.params;
  redirect(docHref(params.docId));
}
