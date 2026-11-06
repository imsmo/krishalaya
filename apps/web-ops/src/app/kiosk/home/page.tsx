// apps/web-ops/src/app/kiosk/home/page.tsx · PC-56 OPS-1c · W380 (canon `kiosk/home`) — A READ of the signed-in person's OWN ambassador profile
// (`GET /v1/ambassadors/me`, the server resolves the caller — no id is sent) and her newest earning rows (`GET /v1/ambassadors/me/earnings`,
// rows only; the platform returns no total and this page computes none). `/kiosk` answers a REAL 307 here (next.config.js, OPS1C_REDIRECTS).
// Honest states: this sign-in has no ambassador profile here (404 AMBASSADOR_NOT_FOUND — most ops staff are tenant administrators); the
// programme is switched off (the `ambassadors` flag's bare 404). Neither read is audited (her own data — recorded, not changed). Links to W381–W389.
import type { Metadata } from 'next';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { KioskHomeView, type KioskEarningView, type KioskProfileView } from '../../../components/ops1/KioskViews';
import { KIOSK_HOME, kioskReadState } from '../../../features/ops1/kiosk';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.kiosk.home.title'), robots: { index: false, follow: false } };
}
const answer = (e: unknown) => (e instanceof SdkError ? { status: e.status, code: e.code } : 'failed' as const);

export default async function KioskHomePage() {
  await requireSession(KIOSK_HOME);
  const t = getTranslator(); const lang = getLang();
  const client = opsClient();
  let profile: KioskProfileView | null = null; let earnings: KioskEarningView[] = [];
  let result: 'ok' | { status: number; code?: string } | 'failed' = 'ok';
  try { profile = (await client.ambassadors.myProfile()) as KioskProfileView; } catch (e) { result = answer(e); }
  if (result === 'ok') {
    try { earnings = (await client.ambassadors.myEarnings({ limit: 5 })).items as KioskEarningView[]; } catch (e) { result = answer(e); }
  }
  return <KioskHomeView t={t} lang={lang} state={kioskReadState(result)} profile={profile} earnings={earnings} />;
}
