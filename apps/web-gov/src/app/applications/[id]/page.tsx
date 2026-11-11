// apps/web-gov/src/app/applications/[id]/page.tsx · PC-56 GOV-2c — W331 (`/applications/[id]`) and its chains as `?do=…&act=` states: the
// ACT (W3159–W3161, `?do=verify|clarify|approve|reject`, REAL — GOV-2a's `POST /v1/gov/applications/:id/act`; the confirm state shows the
// act's form with an Idempotency-Key minted HERE, so a double submit is one act) and the re-read (`?do=reread`, PARITY-DECOR — the error
// state's Retry). Gated by requireGov (E2). Reads `GET /v1/gov/applications/:id` (recorded for the application's organisation every time —
// so the chain states that need no application, success / failure, do not read it) and `GET /v1/gov/members` (the lone-head fact; a refusal
// there leaves the fact unsaid). An unknown, malformed, unsent or another authority's application answers the same 404. noindex.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { SdkError, type GovApplicationOpened, type GovMembership } from '@krishalaya/sdk-js';
import { requireGov } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { govClient } from '../../../lib/api-client';
import { ActDoneNote, ActFailureNote, ActForm, ApplicationDetailView } from '../../../components/gov2/ApplicationsViews';
import { Gov2Chain } from '../../../components/gov2/Gov2Chain';
import { chain2State } from '../../../features/gov2/refusals';
import {
  actErrorCode, actParam, appChainBack, appChainFor, applicationState, decisionFact, isApplicationId, offeredActs, statusKey, type ReadError,
} from '../../../features/gov2/applications';
import { actOnApplicationAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov2.app.title'), robots: { index: false, follow: false } };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const errOf = (e: unknown): ReadError => (e instanceof SdkError ? { status: e.status, code: e.code } : { status: 500, code: 'UNKNOWN' });

export default async function ApplicationPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const id = params.id;
  const me = await requireGov(isApplicationId(id) ? `/applications/${id}` : '/applications');
  const t = getTranslator();
  const chain = appChainFor(searchParams, true);
  const state = chain ? chain2State(chain, searchParams) : null;
  const back = appChainBack(id);

  if (chain === 'application_reread' && state) return <Gov2Chain t={t} chain={chain} state={state} back={back} />;
  if (chain === 'application_act' && state === 'success') {
    const s = one(searchParams.status);
    return <Gov2Chain t={t} chain={chain} state={state} back={back}><ActDoneNote t={t} status={s && statusKey(s) !== 'common.dash' ? s : null} /></Gov2Chain>;
  }
  if (chain === 'application_act' && state === 'failure') {
    return <Gov2Chain t={t} chain={chain} state={state} back={back}><ActFailureNote t={t} error={actErrorCode(searchParams.error)} /></Gov2Chain>;
  }

  const client = govClient();
  let app: GovApplicationOpened | null = null;
  let err: ReadError | null = null;
  try { app = await client.gov.applications.get(id); } catch (e) { err = errOf(e); }
  const appState = applicationState(app, err);

  if (chain === 'application_act' && state === 'confirm') {
    const act = actParam(searchParams.do);
    // the confirm form is shown only for an act this person is OFFERED on this application now (the API decides again)
    if (appState === 'ok' && app && act && offeredActs(me, app.status, null).includes(act)) {
      return <Gov2Chain t={t} chain={chain} state={state} back={back}><ActForm t={t} appId={app.id} act={act} idemKey={randomUUID()} action={actOnApplicationAction} /></Gov2Chain>;
    }
    return <Gov2Chain t={t} chain={chain} state="failure" back={back}><ActFailureNote t={t} error={appState === 'not_found' ? 'GOV_APPLICATION_NOT_FOUND' : 'GOV_ACT_NOT_NOW'} /></Gov2Chain>;
  }

  let rows: GovMembership[] | null = null;
  if (appState === 'ok' && me.person.permissions.includes('authority.members.read')) {
    try { rows = await client.gov.members.list(); } catch { rows = null; }
  }
  return <ApplicationDetailView t={t} state={appState} me={me} id={id} app={app} facts={null} decision={decisionFact(rows, me.person.userId)} />;
}
