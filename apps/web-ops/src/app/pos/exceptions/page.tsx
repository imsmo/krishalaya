// apps/web-ops/src/app/pos/exceptions/page.tsx · PC-56 OPS-3a · W364 (canon `pos/exceptions`) — HONEST: READS NOTHING (founder Q4-A, Q9b-A, Q10-A, Q11-A,
// Q14-A). What this counter cannot do — correct a recorded pour, record a second pour in a shift, take a witness, print or reprint — and what she
// can do. No API call, no input; its canon "Retry" (FM:41) is DECOR (there is nothing to read again).
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { PosExceptionsView } from '../../../components/ops3/CounterViews';
import { POS } from '../../../features/ops3/counter';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops3.pos.ex.title'), robots: { index: false, follow: false } }; }

export default async function PosExceptionsPage() {
  await requireSession(POS.exceptions);
  return <PosExceptionsView t={getTranslator()} />;
}
