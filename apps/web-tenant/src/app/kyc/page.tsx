// apps/web-tenant/src/app/kyc/page.tsx · PC-56 TENANT-SW-c · THE KYC DESK MOVED TO ITS CANON PATH — W157 `/people/verification`.
// Old links (bookmarks, the auditor realm's scope link, notices) keep working: this route redirects, carrying every GET-form filter
// and the cursor. The staff member's own documents (`/kyc/me`) and the submit form (`/kyc/submit`) stay where they are.
import { redirect } from 'next/navigation';
import { VERIFICATION_HREF } from '../../features/kyc/desk';

export const dynamic = 'force-dynamic';

export default function KycDeskMoved({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === 'string') q.set(k, v);
  const s = q.toString();
  redirect(s ? `${VERIFICATION_HREF}?${s}` : VERIFICATION_HREF);
}
