// apps/web-admin/src/app/impersonation/grants/[id]/page.tsx · act-as grant detail + close controls + the
// per-action audit trail. Server component: requireAdmin gates, fetches GET /v1/impersonation/grants/:id (404 →
// notFound) and GET :id/actions (the exhaustive log of every request made under the grant; degrades independently).
// End / revoke are surfaced only while the grant is active (features/impersonation mirrors the state machine) as
// Server-Action forms with a mandatory ≥8-char justification; admin-api requires FIDO2 + step-up, so a 403 degrades
// to a re-auth notice. The act-as token is never shown (it was returned once, server-side, at mint). No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import {
  grantStatusKey, canEndGrant, canRevokeGrant, actionOutcomeTone, actionOutcomeKey, enforcementClass, enforcementKey,
  isElapsedButActive, minutesLeft, sessionShapeClass, sessionShapeKey,
  type ActionCounts, type EnforcementState, type GrantRow, type ActionRow,
} from '../../../../features/impersonation/grant';
import { endGrantAction, revokeGrantAction } from '../../actions';

import { Button, Callout, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('imp.detailTitle'), robots: { index: false, follow: false } };
}

const ST_TONE: Record<string, StatusTone> = { active: 'danger', ended: 'neutral', expired: 'neutral', revoked: 'warning' };
const OK = new Set(['minted', 'ended', 'revoked']);
const ERR = new Set(['reason', 'elevation', 'conflict', 'notFound', 'generic']);

export default async function GrantDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  // PC-56 ADMIN-9b: the detail payload now carries the action counts and the enforcement state, because every claim on
  // this page depends on whether the honouring side is actually running — and until this wave it was not.
  type GrantDetail = GrantRow & { actionCounts?: ActionCounts; enforcement?: EnforcementState };
  let grant: GrantDetail | undefined; let notice: string | undefined;
  try { grant = (await adminGet<GrantDetail>(`impersonation/grants/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let actions: (ActionRow & { outcome?: string; statusCode?: number | null; detail?: string | null })[] = [];
  try { actions = (await adminGet<(ActionRow & { outcome?: string })[]>(`impersonation/grants/${encodeURIComponent(params.id)}/actions`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!grant) {
    return <section><p className="kv-backlink"><Link href="/impersonation">{t.t('imp.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = grantStatusKey(grant.status);

  const nowMs = Date.now();
  const elapsed = isElapsedButActive(grant.status, grant.expiresAt ?? null, nowMs);
  const left = s === 'active' && !elapsed ? minutesLeft(grant.expiresAt ?? null, nowMs) : null;

  type ActionRowX = ActionRow & { outcome?: string; statusCode?: number | null; detail?: string | null };
  const actionCols: Column<ActionRowX>[] = [
    { header: t.t('imp.actWhen'), cell: (a) => a.createdAt ?? t.t('common.dash') },
    { header: t.t('imp.actMethod'), cell: (a) => a.method },
    { header: t.t('imp.actPath'), cell: (a) => a.path },
    { header: t.t('imp.actName'), cell: (a) => a.action ?? t.t('common.dash') },
    {
      // **W008's THIRD ROW IS A REFUSAL** — "write attempt blocked — listings.update denied (scope read_only)" — and
      // before this wave the log had no column that could express one. A blocked write and a use-after-end are the two
      // rows a reviewer is actually looking for.
      header: t.t('imp.actOutcome'),
      cell: (a) => {
        const o = a.outcome ?? 'served';
        return (
          <>
            <StatusPill tone={actionOutcomeTone(o)} label={t.t(actionOutcomeKey(o))} />
            {a.statusCode ? <> {a.statusCode}</> : null}
            {a.detail ? <><br /><small>{a.detail}</small></> : null}
          </>
        );
      },
    },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/impersonation">{t.t('imp.back')}</Link></p>
      <h1>{t.t('imp.detailTitle')}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`imp.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`imp.error.${errKey}`)}</p>}

      {/* WHAT IS ENFORCED — first, because it qualifies everything below it. */}
      <p className={enforcementClass(grant.enforcement)}>{t.t(enforcementKey(grant.enforcement))}</p>
      {grant.enforcement ? (
        <Callout tone="info">
          {t.t('imp.revocationTakesEffect', { when: grant.enforcement.revocationTakesEffect })}
        </Callout>
      ) : null}
      {/* THE SESSION'S SHAPE IN ONE SENTENCE. */}
      <p className={sessionShapeClass(grant.actionCounts)}>
        {t.t(sessionShapeKey(grant.actionCounts), {
          served: String(grant.actionCounts?.served ?? 0),
          blocked: String(grant.actionCounts?.refusedWrite ?? 0),
          after: String(grant.actionCounts?.refusedGrant ?? 0),
        })}
      </p>
      {elapsed ? <Callout tone="warning">{t.t('imp.elapsedNotReconciled')}</Callout> : null}
      {left !== null ? <Callout tone="info">{t.t('imp.minutesLeft', { n: String(left) })}</Callout> : null}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('imp.status')}</dt><dd><StatusPill tone={ST_TONE[s]} label={t.t(`imp.state.${s}`)} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.operator')}</dt><dd>{grant.adminUserId}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.targetTenant')}</dt><dd>{grant.targetTenantId}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.targetUser')}</dt><dd>{grant.targetUserId}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.scope')}</dt><dd>{grant.scope}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.reason')}</dt><dd>{grant.reason}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.expiresAt')}</dt><dd>{grant.expiresAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.endedAt')}</dt><dd>{grant.endedAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.endedBy')}</dt><dd>{grant.endedBy ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.endReason')}</dt><dd>{grant.endReason ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('imp.createdAt')}</dt><dd>{grant.createdAt ?? t.t('common.dash')}</dd></div>
      </dl>

      <h2>{t.t('imp.close')}</h2>
      {canEndGrant(s) || canRevokeGrant(s) ? (
        <div className="kv-action-cards">
          {canEndGrant(s) && (
            <form action={endGrantAction} className="kv-card kv-action-card">
              <input type="hidden" name="id" value={grant.id} />
              <p className="kv-field__hint">{t.t('imp.endHint')}</p>
              <label className="kv-field__label">{t.t('imp.reason')}</label>
              <input name="reason" className="kv-input" required minLength={8} maxLength={1000} />
              <Button type="submit">{t.t('imp.end')}</Button>
            </form>
          )}
          {canRevokeGrant(s) && (
            <form action={revokeGrantAction} className="kv-card kv-action-card">
              <input type="hidden" name="id" value={grant.id} />
              <p className="kv-field__hint">{t.t('imp.revokeHint')}</p>
              <label className="kv-field__label">{t.t('imp.reason')}</label>
              <input name="reason" className="kv-input" required minLength={8} maxLength={1000} />
              <Button type="submit" variant="danger">{t.t('imp.revoke')}</Button>
            </form>
          )}
        </div>
      ) : <p className="kv-muted">{t.t('imp.closed')}</p>}

      <h2>{t.t('imp.actionsHeading')}</h2>
      {/* The note this page could not honestly make before: the rows are written by the SERVER that served each
          request, not by the operator choosing to report themselves. */}
      <p className="kv-field__hint">{t.t('imp.actionsNote')}</p>
      <Callout tone="info">{t.t('imp.actionsWrittenBy')}</Callout>
      <DataTable columns={actionCols} rows={actions} empty={t.t('imp.actionsEmpty')} />
    </section>
  );
}
