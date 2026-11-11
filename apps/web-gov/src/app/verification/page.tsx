// apps/web-gov/src/app/verification/page.tsx · PC-56 GOV-4a — W335 (`/verification`, "Field visits") and its chains as `?do=…&act=` states: the
// file chain (W3189–W3190, `?do=file`), the form chain (W3191–W3194, `?do=draft`) and the act chain (W3195–W3197, `?do=act`) — all DECOR.
// Gated by requireGov. READS NOTHING (E2): field visits are not scheduled or recorded on this platform (GOV-4 Q2-A), and this console never
// shows where a farm is, pictures or recordings from one, documents or a farmer's phone (Q1-A). W336, W337 and W338 are this page's section
// "What this console does not do" (E1: one route; `/verification/[id]`, `/verification/[id]/visit`, `/verification/review` have no route and
// answer not found). Since GOV-4a the GOV-1a 307 for /verification is gone (next.config.js). noindex.
import type { Metadata } from 'next';
import { requireGov } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { Gov4Chain, VerificationView } from '../../components/gov4/VerificationViews';
import { chain4For, chain4State } from '../../features/gov4/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov4.verification.title'), robots: { index: false, follow: false } };
}

export default async function VerificationPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requireGov('/verification');
  const t = getTranslator();
  const chain = chain4For(searchParams);
  const act = chain ? chain4State(chain, searchParams) : null;
  if (chain && act) return <Gov4Chain t={t} chain={chain} state={act} />;
  return <VerificationView t={t} me={me} />;
}
