// apps/web-gov/src/app/access/page.tsx · PC-56 GOV-1a — W359 (`/access`) and the access chain (W3198–W3200 as `?act=` states). Gated by
// requireGov (E2). Reads `GET /v1/gov/members` (GOV-0 — `authority.members.read`, held by every live member of THIS authority) and renders
// components/gov1/AccessViews.tsx: the authority's people, Q4-A's sentence, the acts as offers. `?act=confirm&do=request|approve|remove`
// shows the act's form (a key minted here); `&do=reread` is the PARITY-DECOR chain opened by the error state's Retry. PC-56 GOV-4b: the
// "Sign-ins" section (W356) is inside AccessView and reads nothing; `?do=signins-file|signins-reread&act=` are W3262–W3266. noindex.
// PC-56 GOV-6b: "The record" (W334) and "Outside bodies" (W351–W354) are inside AccessView and read nothing (no /audit or /regulator route);
// their chains `?do=record-file|record-reread|outside-file|outside-form|outside-reread&act=` (W3206–W3210, W3244–W3252) are answered before
// any read. The page's ONE read is unchanged.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { SdkError, type GovMembership } from '@krishalaya/sdk-js';
import { getLang, getTranslator } from '../../lib/i18n';
import { govClient } from '../../lib/api-client';
import { requireGov } from '../../lib/session';
import { AccessDoneNote, AccessFailureNote, AccessView, ApproveConfirm, RemoveForm, RequestForm, type AccessState } from '../../components/gov1/AccessViews';
import { Gov1Chain } from '../../components/gov1/Gov1Chain';
import { chain1State } from '../../features/gov1/refusals';
import { accessDo, accessDone, accessErrorCode } from '../../features/gov1/access';
import { approveRoleAction, removeRoleAction, requestRoleAction } from './actions';
import { Gov4Chain } from '../../components/gov4/VerificationViews';
import { chain4For, chain4State } from '../../features/gov4/refusals';
import { Gov6Chain } from '../../components/gov6/DashboardSections';
import { chain6For, chain6State } from '../../features/gov6/refusals';

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
  const chain6 = chain6For(searchParams, 'access');   // GOV-6b: the record and outside-body chains (W3206–W3210, W3244–W3252) — no read
  const act6 = chain6 ? chain6State(chain6, searchParams) : null;
  if (chain6 && act6) return <Gov6Chain t={t} chain={chain6} state={act6} />;
  const doing = accessDo(searchParams.do);
  const chain = doing === 'reread' ? 'access_reread' : 'access_act';
  const act = chain1State(chain, searchParams);

  if (act === 'success' || act === 'failure' || (act === 'confirm' && doing === 'reread')) {
    return (
      <Gov1Chain t={t} chain={chain} state={act}>
        {chain === 'access_act' && act === 'success'
          ? <AccessDoneNote t={t} lang={getLang()} done={accessDone(searchParams.done)} expiresAt={one(searchParams.ends) ?? null} sessionsEnded={Number(one(searchParams.ended)) || 0} /> : null}
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
        {doing === 'approve' ? <ApproveConfirm t={t} lang={getLang()} row={row} rows={rows} me={me} idemKey={key} action={approveRoleAction} /> : null}
        {doing === 'remove' ? <RemoveForm t={t} lang={getLang()} row={row} rows={rows} me={me} idemKey={key} action={removeRoleAction} /> : null}
      </Gov1Chain>
    );
  }
  return <AccessView t={t} state={state} me={me} rows={rows} lang={getLang()} />;
}
