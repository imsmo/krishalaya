// apps/web-gov/src/app/access/page.tsx · PC-56 GOV-1a — W359 (`/access`) and the access chain (W3198–W3200 as `?act=` states). Gated by
// requireGov (E2). Reads `GET /v1/gov/members` (GOV-0 — `authority.members.read`, held by every live member of THIS authority) and renders
// components/gov1/AccessViews.tsx: the authority's people, Q4-A's sentence, the acts as offers. `?act=confirm&do=request|approve|remove`
// shows the act's form (a key minted here); `&do=reread` is the PARITY-DECOR chain opened by the error state's Retry. PC-56 GOV-4b: the
// "Sign-ins" section (W356) is inside AccessView and reads nothing; `?do=signins-file|signins-reread&act=` are W3262–W3266. noindex.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { SdkError, type GovMembership } from '@krishalaya/sdk-js';
import { getTranslator } from '../../lib/i18n';
import { govClient } from '../../lib/api-client';
import { requireGov } from '../../lib/session';
import { AccessDoneNote, AccessFailureNote, AccessView, ApproveConfirm, RemoveForm, RequestForm, type AccessState } from '../../components/gov1/AccessViews';
import { Gov1Chain } from '../../components/gov1/Gov1Chain';
import { chain1State } from '../../features/gov1/refusals';
import { accessDo, accessDone, accessErrorCode } from '../../features/gov1/access';
import { approveRoleAction, removeRoleAction, requestRoleAction } from './actions';
import { Gov4Chain } from '../../components/gov4/VerificationViews';
import { chain4For, chain4State } from '../../features/gov4/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov1.access.title'), robots: { index: false, follow: false } };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AccessPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requireGov('/access');
  const t = getTranslator();
  // PC-56 GOV-4b · W3262–W3266: the sign-ins chains (`?do=signins-file|signins-reread&act=`) read nothing; they are answered first.
  const chain4 = chain4For(searchParams, 'access');
  const state4 = chain4 ? chain4State(chain4, searchParams) : null;
  if (chain4 && state4) return <Gov4Chain t={t} chain={chain4} state={state4} />;
  const doing = accessDo(searchParams.do);
  const chain = doing === 'reread' ? 'access_reread' : 'access_act';
  const act = chain1State(chain, searchParams);

  if (act === 'success' || act === 'failure' || (act === 'confirm' && doing === 'reread')) {
    return (
      <Gov1Chain t={t} chain={chain} state={act}>
        {chain === 'access_act' && act === 'success'
          ? <AccessDoneNote t={t} done={accessDone(searchParams.done)} expiresAt={one(searchParams.ends) ?? null} sessionsEnded={Number(one(searchParams.ended)) || 0} /> : null}
        {chain === 'access_act' && act === 'failure' ? <AccessFailureNote t={t} error={accessErrorCode(searchParams.error)} /> : null}
      </Gov1Chain>
    );
  }

  let rows: GovMembership[] = [];
  let state: AccessState = 'ok';
  try { rows = await govClient().gov.members.list(); }
  catch (e) { state = e instanceof SdkError && e.status === 403 ? 'forbidden' : e instanceof SdkError && e.status === 404 ? 'off' : 'error'; }

  if (act === 'confirm' && doing && doing !== 'reread') {
    const id = one(searchParams.id) ?? '';
    const row = rows.find((r) => r.membershipId === id) ?? null;
    const key = randomUUID();
    return (
      <Gov1Chain t={t} chain="access_act" state="confirm">
        {doing === 'request' ? <RequestForm t={t} idemKey={key} action={requestRoleAction} /> : null}
        {doing === 'approve' ? <ApproveConfirm t={t} row={row} rows={rows} me={me} idemKey={key} action={approveRoleAction} /> : null}
        {doing === 'remove' ? <RemoveForm t={t} row={row} rows={rows} me={me} idemKey={key} action={removeRoleAction} /> : null}
      </Gov1Chain>
    );
  }
  return <AccessView t={t} state={state} me={me} rows={rows} />;
}
