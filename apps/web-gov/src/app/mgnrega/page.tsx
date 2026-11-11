// apps/web-gov/src/app/mgnrega/page.tsx · PC-56 GOV-5a — W345 (`/mgnrega`, "MGNREGA") and its chains as `?do=…&act=` states: job file
// (W3224–W3225, `?do=job-file`, DECOR), job re-read (W3226–W3228, `?do=job-reread`, PARITY-DECOR), sync (W3233–W3235, `?do=sync`, DECOR),
// muster re-read (W3236–W3238, `?do=muster-reread`, PARITY-DECOR), demand form (W3275–W3278, `?do=demand`, DECOR), work re-read
// (W3279–W3281, `?do=work-reread`, PARITY-DECOR). Gated by requireGov. READS NOTHING (E2): MGNREGA's register is NREGASoft; this console
// records no work demand and does not connect to it (GOV-5 Q3-A); it shows no job card, worker, household, attendance or worksite (Q2-A) and
// no wage or payment figure (Q1-A). W346, W347, W348 and W440 are this page's section "What this console does not do" (E1: one route;
// `/mgnrega/dashboard`, `/job-cards`, `/demand`, `/musters`, `/musters/[id]` have no route and answer not found). Since GOV-5a the GOV-1a 307
// for /mgnrega is gone (next.config.js). GOV-5b: the sections "Wages" (W349, Q1-A) and "Social audit" (W350, Q5-A) are part of the same
// view; chains wage file (W3270–W3271, `?do=wage-file`, DECOR), wage re-read (W3272–W3274, `?do=wage-reread`, PARITY-DECOR), publish
// (W3267–W3269, `?do=publish`, DECOR — nothing is published); `/mgnrega/wages`, `/audit` and `/social-audit` have no route. noindex.
import type { Metadata } from 'next';
import { requireGov } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { Gov5Chain, MgnregaView } from '../../components/gov5/MgnregaViews';
import { chain5For, chain5State } from '../../features/gov5/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov5.mgnrega.title'), robots: { index: false, follow: false } };
}

export default async function MgnregaPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requireGov('/mgnrega');
  const t = getTranslator();
  const chain = chain5For(searchParams);
  const act = chain ? chain5State(chain, searchParams) : null;
  if (chain && act) return <Gov5Chain t={t} chain={chain} state={act} />;
  return <MgnregaView t={t} me={me} />;
}
