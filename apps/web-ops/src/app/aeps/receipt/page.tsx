// apps/web-ops/src/app/aeps/receipt/page.tsx · PC-56 OPS-1b · W393 (canon `aeps/receipt`) — THERE IS NO RECEIPT HERE: an HONEST PAGE THAT READS
// NOTHING (founder Q1-A, survey F-4). The bank's device prints the bank's slip; this console keeps the operator's record. Its "Retry" (FM:101)
// opens the aeps chain's confirm state on /aeps/withdrawal — the chain never returns here.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { AepsReceiptView } from '../../../components/ops1/AepsViews';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.aeps.receipt.title'), robots: { index: false, follow: false } };
}
export default async function AepsReceiptPage() {
  await requireSession('/aeps/receipt');
  return <AepsReceiptView t={getTranslator()} />;
}
