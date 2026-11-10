// apps/web-ops/src/app/animals/transfer/page.tsx · PC-56 OPS-4b · W396 (canon `animals/transfer`) — HONEST: THIS PAGE READS NOTHING (founder Q4-A / Q5-A, applied by the
// lead). Kiosk chrome (OPS-1c); zero inputs; no API call. Reached from the kiosk home and the other animal pages (the canon drew no link to it).
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { AnimalHonestView } from '../../../components/ops4/AnimalViews';

import { ANIMALS } from '../../../features/ops4/upkeep';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops4.animals.transfer.title'), robots: { index: false, follow: false } }; }

export default async function AnimalTransferPage() {
  await requireSession(ANIMALS.transfer);
  const t = getTranslator();
  return <AnimalHonestView t={t} surface="animal_transfer" />;
}
