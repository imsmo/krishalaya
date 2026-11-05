// apps/web-ops/src/app/attendance/face-enroll/page.tsx · PC-56 OPS-1b · W397 (canon `attendance/face-enroll`) — NO FACE CAPTURE (founder Q5-A):
// an HONEST PAGE THAT READS NOTHING.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { FaceEnrollView } from '../../../components/ops1/FaceViews';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.face.enroll.title'), robots: { index: false, follow: false } };
}
export default async function FaceEnrollPage() {
  await requireSession('/attendance/face-enroll');
  return <FaceEnrollView t={getTranslator()} />;
}
