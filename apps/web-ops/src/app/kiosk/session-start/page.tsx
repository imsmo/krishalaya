// apps/web-ops/src/app/kiosk/session-start/page.tsx · PC-56 OPS-1c · W381 (canon `kiosk/session-start`; the address is kept, the page claims no
// "session" — Q10-A) — CREATE AN ACCOUNT FOR A NEW NUMBER: the one form of the kiosk (phone, name, language from the platform registry),
// REAL over the existing keyed `POST /v1/users`. It reads nothing before the act.
// `?act=confirm|success|failure` is the W3329–W3331 chain (REAL): confirm = the same form under "Create an account for this number"; success =
// "An account exists for this number; she signs in on her own phone"; failure = "Nothing was created" with the server's named reason (409 →
// Q9-A's sentence, nothing about the person). Back → this page, never W380 (the canon's defect).
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { KioskFailureView, KioskStartView, KioskSuccessView } from '../../../components/ops1/KioskViews';
import { chain1State } from '../../../features/ops1/refusals';
import { KIOSK_LANGUAGES } from '../../../features/kiosk/form';
import { KIOSK_START } from '../../../features/ops1/kiosk';
import { createAccountAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.kiosk.start.title'), robots: { index: false, follow: false } };
}

export default async function KioskStartPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(KIOSK_START);
  const t = getTranslator();
  const act = chain1State('kiosk_act', searchParams);
  if (act === 'confirm') return <KioskStartView t={t} mode="confirm" action={createAccountAction} languages={KIOSK_LANGUAGES} />;
  if (act === 'failure') return <KioskFailureView t={t} searchParams={searchParams} />;   // the reason is parsed (parseKioskReason) — nothing else is read
  if (act === 'success') return <KioskSuccessView t={t} />;
  return <KioskStartView t={t} mode="page" action={createAccountAction} languages={KIOSK_LANGUAGES} />;
}
