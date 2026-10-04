// apps/web-tenant/src/app/kyc/[docId]/act/page.tsx · PC-56 TENANT-SW-c · the KYC mutate chain moved with its document — W2338–W2340
// `/people/verification/[id]/act`. An old link redirects with its step / act / reason carried (never a note).
import { redirect } from 'next/navigation';
import { docHref } from '../../../../features/kyc/desk';

export const dynamic = 'force-dynamic';

export default function KycActMoved({ params, searchParams }: { params: { docId: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  for (const k of ['step', 'act', 'reasonCode', 'error', 'link']) { const v = searchParams[k]; if (typeof v === 'string') q.set(k, v); }
  redirect(`${docHref(params.docId)}/act${q.toString() ? `?${q.toString()}` : ''}`);
}
