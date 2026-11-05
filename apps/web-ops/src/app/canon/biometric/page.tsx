// apps/web-ops/src/app/canon/biometric/page.tsx · PC-56 OPS-1b · W399 (canon `canon/biometric`) — WHAT IS STORED, AND WHAT IS NOT: an HONEST
// reference page that READS NOTHING (founder Q5-A, Q7-A). A platform policy page — never a dairy page (the canon draws it in the MCC sidebar, F-17).
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { BiometricCanonView } from '../../../components/ops1/FaceViews';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.bio.title'), robots: { index: false, follow: false } };
}
export default async function BiometricCanonPage() {
  await requireSession('/canon/biometric');
  return <BiometricCanonView t={getTranslator()} />;
}
