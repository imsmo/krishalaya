// apps/web-storefront/src/app/(platform)/trace/page.tsx · PC-56 STORE-1b · C1/C2 — "How farm-to-fork trace works" (the platform footer's
// link) AND the target of the home's "Scan a trace QR" GET form: `/trace?code=<typed>` with a well-formed code goes straight to that lot's
// record (/trace/<code>); a malformed one is answered here, with the code kept in the field. No camera scanner (refused by name); no demo
// lot (refused by name — no public demonstration lot exists).
// PC-56 STORE-SWEEP-b · D5: the screen moved to components/sweep/TraceEntry.tsx (one screen, both chromes — a store renders `/<slug>/trace`).
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { TraceEntry } from '../../../components/sweep/TraceEntry';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('trace.how.title'), description: t.t('home.trace.body') };
}

export default function TraceHowPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <TraceEntry base="" searchParams={searchParams} />;
}
