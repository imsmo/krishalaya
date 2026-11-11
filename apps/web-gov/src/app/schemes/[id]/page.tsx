// apps/web-gov/src/app/schemes/[id]/page.tsx · PC-56 GOV-2b — one of the authority's schemes, three tabs: identity and benefit (W327,
// `?tab=identity`), eligibility rules (W328, `?tab=rules`), versions (W329, `?tab=versions`); and its chains as `?do=…&act=` states — the
// scheme form (W3182–W3185, `do=scheme`), the scheme send (W3186–W3188, `do=send`), the rule form (W3172–W3175, `do=rule`), the rule removal
// (W3176–W3178, `do=remove`) — all DECOR, refused BY NAME (Q5-A) — and the re-reads (`do=reread`, PARITY-DECOR). Back → THIS scheme.
// Gated by requireGov (E2). Reads only GOV-2a's B3: `gov.schemes.get` (every tab), `gov.schemes.versions` + `gov.schemes.diff` (the versions
// tab). Another authority's scheme answers the same 404 as an unknown one. Writes nothing; calls no write. noindex.
import type { Metadata } from 'next';
import { SdkError, type GovScheme, type GovSchemeVersion, type GovSchemeVersionDiff } from '@krishalaya/sdk-js';
import { requireGov } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { govClient } from '../../../lib/api-client';
import { SchemeDetailView, type DiffState } from '../../../components/gov2/SchemesViews';
import { Gov2Chain } from '../../../components/gov2/Gov2Chain';
import { chain2Back, chain2For, chain2State, isSchemeId, schemeTab } from '../../../features/gov2/refusals';
import { diffVersion, schemeState, type ReadError } from '../../../features/gov2/schemes';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov2.detail.title'), robots: { index: false, follow: false } };
}

const errOf = (e: unknown): ReadError => (e instanceof SdkError ? { status: e.status, code: e.code } : { status: 500, code: 'UNKNOWN' });

export default async function SchemePage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const id = params.id;
  await requireGov(isSchemeId(id) ? `/schemes/${id}` : '/schemes');
  const t = getTranslator();
  const tab = schemeTab(searchParams);
  const chain = chain2For(searchParams, true);
  const act = chain ? chain2State(chain, searchParams) : null;
  if (chain && act) return <Gov2Chain t={t} chain={chain} state={act} back={chain2Back(chain, id, tab)} />;

  const client = govClient();
  let scheme: GovScheme | null = null;
  let err: ReadError | null = null;
  try { scheme = await client.gov.schemes.get(id); } catch (e) { err = errOf(e); }
  const state = schemeState(scheme, err);

  let versions: GovSchemeVersion[] = [];
  let diff: GovSchemeVersionDiff | null = null;
  let diffState: DiffState = 'none';
  if (state === 'ok' && tab === 'versions') {
    try { versions = await client.gov.schemes.versions(id); } catch { diffState = 'error'; }
    const n = diffVersion(searchParams.v, versions);
    if (n !== null && diffState !== 'error') {
      try { diff = await client.gov.schemes.diff(id, n); diffState = 'ok'; } catch { diffState = 'error'; }
    }
  }
  return <SchemeDetailView t={t} state={state} id={id} tab={tab} scheme={scheme} versions={versions} diff={diff} diffState={diffState} />;
}
