// apps/web-ops/src/app/iot/alert-rules/page.tsx · PC-56 OPS-5a · W402 (canon `iot/alert-rules`) — THE ALERT RULES: A READ, and ONE REAL act, the change
// (the alert chain W3292–W3294 as query states, `?act=`). Reads, both EXISTING, behind `logistics` (`logistics.manage`): `GET …/cold-chain/alert-rules`
// (each rule with its open proposal and its last recorded change — HOTFIX-14 / the 5a first commit) and `GET …/cold-chain/alerts/feed` (the latest
// 200 fired alerts: each rule's own, and the breaches' and silences' own). The chain states are answered FIRST: `?act=success|failure` read nothing;
// `?act=confirm` reads the rules to show the form for one rule (`&rule=`), a new rule (`&new=1`) or one open proposal (`&change=`).
// `/devices/rules` and `/devices/alerts` answer a 307 here (next.config.js).
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { AlertRulesView, ChangeDoneNote, ChangeFailureNote, ChangeForm, NewRuleForm, ProposalReview } from '../../../components/ops5/AlertViews';
import { Ops5Chain } from '../../../components/ops5/Ops5Chain';
import { chain5State } from '../../../features/ops5/refusals';
import { iotState } from '../../../features/ops4/iot';
import { ALERTS, asFired, asRules, parseDone, parseFailure, parseFormError, uuidParam, type FiredRow, type RuleRow } from '../../../features/ops5/alerts';
import { confirmChangeAction, createRuleAction, proposeChangeAction, withdrawChangeAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops5.alerts.title'), robots: { index: false, follow: false } }; }
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AlertRulesPage({ searchParams }: { searchParams?: SP }) {
  await requireSession(ALERTS.rules);
  const t = getTranslator();
  const act = chain5State('alert_act', searchParams);
  const ruleParam = uuidParam(one(searchParams?.rule));
  if (act === 'success') return <Ops5Chain t={t} chain="alert_act" state="success" page={ALERTS.rules}><ChangeDoneNote t={t} done={parseDone(searchParams?.done)} /></Ops5Chain>;
  if (act === 'failure') {
    const retry = ruleParam ? `${ALERTS.rules}?act=confirm&rule=${ruleParam}` : ALERTS.rules;
    return <Ops5Chain t={t} chain="alert_act" state="failure" page={ALERTS.rules}><ChangeFailureNote t={t} reason={parseFailure(searchParams?.reason)} retryHref={retry} /></Ops5Chain>;
  }
  if (act === 'confirm' && one(searchParams?.new) === '1') {
    return <Ops5Chain t={t} chain="alert_act" state="confirm" page={ALERTS.rules}><NewRuleForm t={t} idemKey={randomUUID()} action={createRuleAction} error={parseFormError(searchParams?.error)} /></Ops5Chain>;
  }

  let status: 'ok' | number | 'failed' = 'ok';
  let rules: RuleRow[] = [];
  try { rules = asRules(await opsClient().shipments.alertRules({})); }
  catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }

  if (act === 'confirm') {
    if (status !== 'ok') return <AlertRulesView t={t} state={iotState(status)} rules={[]} fired={[]} />;
    const changeId = uuidParam(one(searchParams?.change));
    const rule = rules.find((r) => r.id === ruleParam) ?? null;
    if (changeId) {
      const forChange = rules.find((r) => r.openChange?.id === changeId) ?? null;
      return <Ops5Chain t={t} chain="alert_act" state="confirm" page={ALERTS.rules}>
        <ProposalReview t={t} rule={forChange} idemKey={randomUUID()} confirmAction={confirmChangeAction} withdrawAction={withdrawChangeAction} /></Ops5Chain>;
    }
    if (rule) {
      return <Ops5Chain t={t} chain="alert_act" state="confirm" page={ALERTS.rules}>
        <ChangeForm t={t} rule={rule} idemKey={randomUUID()} action={proposeChangeAction} error={parseFormError(searchParams?.error)} /></Ops5Chain>;
    }
    return <Ops5Chain t={t} chain="alert_act" state="failure" page={ALERTS.rules}><ChangeFailureNote t={t} reason="notFound" retryHref={ALERTS.rules} /></Ops5Chain>;
  }

  let fired: FiredRow[] | null = [];
  if (status === 'ok') { try { fired = asFired(await opsClient().shipments.alertFeed({ limit: 200 })); } catch { fired = null; } }
  return <AlertRulesView t={t} state={iotState(status)} rules={rules} fired={fired} />;
}
