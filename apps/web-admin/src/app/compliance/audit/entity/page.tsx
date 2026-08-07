// apps/web-admin/src/app/compliance/audit/entity/page.tsx · W040, the per-entity lifecycle (PC-56 ADMIN-5e).
//
// "Complete lifecycle from audit_log (idx_audit_entity)" — oldest first, because a lifecycle told newest-first is a
// story told backwards.
//
// THE DIFF IS ITS OWN PERMISSION, and that resolves a tension an earlier wave recorded as unresolved. The explorer
// deliberately never selected `old_value`/`new_value` (a diff carries whatever the changed row carried); W040 needs
// exactly those. The canon had already answered it in the restricted state of both screens: the TIMELINE is
// `audit.read` and the VALUES are `audit.values.read`, so a viewer without the second sees every event, every actor
// and every reason, with the values shown as ▪▪▪.
//
// AND AN UNRECORDED DIFF IS NOT AN UNCHANGED ROW. Most audit writers on this platform record `new_value` only and
// many record neither. Rendering "no changes" for those would tell an auditor that a privileged action changed
// nothing, when the truth is that nobody wrote down what it changed.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { diffStateKey, diffSign, diffLineClass, valueCell, retentionKey, type DiffPanel } from '../../../../features/audit/audit-console';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('aud.entityTitle'), robots: { index: false, follow: false } };
}

interface Entry {
  id: string; action: string; actorUserId: string | null; actorRole: string | null;
  tenantId: string | null; reason: string | null; ip: string | null; requestId: string | null;
  userAgent: string | null; createdAt: string; diff: DiffPanel; diffEmpty: boolean;
}
interface Trail {
  ref: string; entityType: string; entityId: string; entries: Entry[];
  truncated: boolean; limit: number; valuesDisclosed: boolean;
  retention: { immutable: boolean; immutableBasis: string; yearsEnforced: boolean; yearsBasis: string };
}

export default async function AuditEntityPage({ searchParams }: { searchParams: { ref?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const ref = searchParams.ref?.trim();

  let trail: Trail | undefined; let notice: string | undefined;
  if (ref) {
    try { trail = (await adminGet<Trail>('compliance/audit/entity', { ref })).data; }
    catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }
  }

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance/audit">{t.t('aud.backExplorer')}</Link></p>
      <h1>{t.t('aud.entityHeading')}</h1>
      <p className="kv-muted">{t.t('aud.entityLead')}</p>

      <form method="get" className="kv-form kv-filters" aria-label={t.t('aud.entityFilters')}>
        <label htmlFor="ref" className="kv-field__label">{t.t('aud.ref')}</label>
        <input id="ref" name="ref" className="kv-input" defaultValue={ref ?? ''} placeholder="listing/LST-2026-084497" maxLength={200} />
        <button type="submit" className="kv-btn">{t.t('aud.open')}</button>
      </form>

      {notice && <p className="kv-error" role="alert">{notice}</p>}
      {!ref && <p className="kv-empty">{t.t('aud.enterRef')}</p>}

      {trail && (
        <>
          <h2>{trail.ref}</h2>
          {/* W040's "Diffs masked" state, drawn from a fact the server sends rather than inferred from empty panels. */}
          {!trail.valuesDisclosed && <p className="kv-notice" role="note">{t.t('aud.diffsMasked')}</p>}
          {trail.entries.length === 0 && (
            <p className="kv-empty">{t.t('aud.noHistory')}</p>
          )}

          <ol className="kv-timeline">
            {trail.entries.map((e) => {
              const key = diffStateKey(e.diff);
              return (
                <li key={e.id} className="kv-timeline__item">
                  <div className="kv-timeline__head">
                    <strong>{e.action}</strong> · {e.createdAt}
                  </div>
                  <dl className="kv-facts">
                    <div className="kv-facts__row"><dt>{t.t('aud.actor')}</dt><dd>{e.actorUserId ?? t.t('common.dash')}{e.actorRole ? ` · ${e.actorRole}` : ''}</dd></div>
                    <div className="kv-facts__row"><dt>{t.t('aud.tenant')}</dt><dd>{e.tenantId ?? t.t('aud.platform')}</dd></div>
                    <div className="kv-facts__row"><dt>{t.t('aud.reason')}</dt><dd>{e.reason ?? t.t('common.dash')}</dd></div>
                    <div className="kv-facts__row"><dt>{t.t('aud.ip')}</dt><dd>{e.ip ?? t.t('common.dash')}</dd></div>
                    <div className="kv-facts__row"><dt>{t.t('aud.requestId')}</dt><dd>{e.requestId ?? t.t('common.dash')}</dd></div>
                    <div className="kv-facts__row"><dt>{t.t('aud.userAgent')}</dt><dd>{e.userAgent ?? t.t('common.dash')}</dd></div>
                  </dl>

                  {/* THE FIVE DIFF STATES, each with its own sentence. `notRecorded` and `empty` are separate on
                      purpose — "nobody wrote down what changed" and "we recorded both sides and they matched" are
                      opposite facts about whether the platform knows what this action did. */}
                  {key === 'notRecorded' && <p className="kv-detail__muted">{t.t('aud.diff.notRecorded')}</p>}
                  {key === 'empty' && <p className="kv-detail__muted">{t.t('aud.diff.empty')}</p>}
                  {key === 'masked' && e.diff.kind === 'masked' && (
                    <ul className="kv-list">
                      {e.diff.keys.map((k) => (
                        <li key={k}><code>{k}</code>: {valueCell(null, true)}</li>
                      ))}
                    </ul>
                  )}
                  {key === 'opaque' && e.diff.kind === 'opaque' && (
                    <pre className="kv-pre">{`− ${e.diff.before ?? 'null'}\n+ ${e.diff.after ?? 'null'}`}</pre>
                  )}
                  {(key === 'diff' || key === 'created') && (e.diff.kind === 'diff' || e.diff.kind === 'created') && (
                    <ul className="kv-diff">
                      {e.diff.lines.map((l) => (
                        <li key={l.key}>
                          <span className={diffLineClass(l.kind)}>{diffSign(l.kind)}</span>{' '}
                          <code>{l.key}</code>
                          {l.before !== null && <> <del>{valueCell(l.before, false)}</del></>}
                          {l.after !== null && <> <ins>{valueCell(l.after, false)}</ins></>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>

          {/* NOT silently cut off. A truncated lifecycle that looks complete is a lifecycle somebody will draw a
              conclusion from. */}
          {trail.truncated && <p className="kv-error" role="alert">{t.t('aud.truncated', { n: String(trail.limit) })}</p>}

          <p className="kv-detail__muted">
            {t.t(`aud.retention.${retentionKey(trail.retention)}`)}
            {retentionKey(trail.retention) === 'immutableOnly' && ` ${trail.retention.yearsBasis}`}
          </p>
        </>
      )}
    </section>
  );
}
