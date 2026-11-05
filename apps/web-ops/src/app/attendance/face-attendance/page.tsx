// apps/web-ops/src/app/attendance/face-attendance/page.tsx · PC-56 OPS-1b · W398 (canon `attendance/face-attendance`) — HONEST, READS NOTHING.
// Verified before choosing: `GET /v1/labour/attendance/summary` (attendance.controller.ts:43-44 → attendance.service.ts:189-192 →
// attendance.repository.ts:151-167) returns tenant-wide REVIEW tiles — not a booking's counts by method — so a read would print a number
// that does not mean what the canon's line means. No count, no wage figure, no face.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { FaceAttendanceView } from '../../../components/ops1/FaceViews';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.face.attendance.title'), robots: { index: false, follow: false } };
}
export default async function FaceAttendancePage() {
  await requireSession('/attendance/face-attendance');
  return <FaceAttendanceView t={getTranslator()} />;
}
