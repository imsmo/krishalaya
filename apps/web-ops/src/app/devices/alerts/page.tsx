// apps/web-ops/src/app/devices/alerts/page.tsx · OW-7 fired-alerts feed (PC-55 B4, on PC-55 A6).
// The page a human opens when something has gone wrong, so it is ordered for that human and not for the database:
// unacknowledged first, then critical → warning → info, then newest. Whatever is still on fire is at the top before
// anybody touches a filter.
//
// ACKNOWLEDGE is the ONLY thing that can be done to an alert here. There is no delete and no edit, because a fired
// alert is evidence that a threshold was crossed; "a person has seen this" and "this never happened" are different
// claims, and only the first one is ours to make.
//
// "RUN NOW" reports `evaluated / fired / suppressed` verbatim — including suppressed, which is the cooldown dedupe
// doing its job. Hiding that number would make a working guard look like a broken evaluator, and the operator would
// go looking for a bug that isn't there.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { ALERT_KINDS, ALERT_SEVERITIES, feedOrder, isAlertKind, isAlertSeverity, needsAck, type FiredAlertRow } from '../../../features/devices/alerting';
import { acknowledgeAlertAction, evaluateNowAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('iot.alertsTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['acknowledged', 'evaluated']);
const ERR = new Set(['ack', 'evaluate', 'forbidden', 'notfound', 'conflict', 'rule']);

export default async function FiredAlertsPage({ searchParams }: {
  searchParams: { kind?: string; severity?: string; unack?: string; ok?: string; error?: string; evaluated?: string; fired?: string; suppressed?: string };
}) {
  await requireSession('/devices/alerts');
  const t = getTranslator();
  const lang = getLang();

  const kind = isAlertKind(searchParams.kind) ? searchParams.kind : undefined;
  const severity = isAlertSeverity(searchParams.severity) ? searchParams.severity : undefined;
  const unacknowledgedOnly = searchParams.unack === '1';

  let rows: FiredAlertRow[] = []; let failed = false; let forbidden = false;
  try {
    rows = (await opsClient().shipments.alertFeed({ kind, severity, unacknowledgedOnly, limit: 200 })) as FiredAlertRow[];
    rows = [...rows].sort(feedOrder);
  } catch (e) { forbidden = (e as { status?: number }).status === 403; failed = !forbidden; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const open = rows.filter(needsAck).length;

  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { kind, severity, unack: unacknowledgedOnly ? '1' : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/devices/alerts?${s}` : '/devices/alerts';
  };

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('iot.alertsTitle')}</h1>
        <span>
          <Link href="/devices" className="kv-btn--link">← {t.t('iot.title')}</Link>
          {' · '}
          <Link href="/devices/rules" className="kv-btn--link">{t.t('iot.rulesLink')}</Link>
        </span>
      </div>
      <p className="kv-field__hint">{t.t('iot.alertsHint')}</p>

      {okKey === 'evaluated' ? (
        <p className="kv-success" role="status">
          {t.t('iot.ok.evaluated', {
            evaluated: String(searchParams.evaluated ?? '0'),
            fired: String(searchParams.fired ?? '0'),
            suppressed: String(searchParams.suppressed ?? '0'),
          })}
        </p>
      ) : okKey && <p className="kv-success" role="status">{t.t(`iot.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`iot.error.${errKey}`)}</p>}
      {forbidden && <p className="kv-error" role="alert">{t.t('iot.forbidden')}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('iot.loadError')}</p>}

      {!forbidden && !failed && (
        <>
          {open > 0 && <p className="kv-notice" role="note">{t.t('iot.openNotice', { n: String(open) })}</p>}

          <nav className="kv-tabs" aria-label={t.t('iot.filterKind')}>
            <a href={q({ kind: undefined })} className={`kv-tab${!kind ? ' kv-tab--active' : ''}`} aria-current={!kind ? 'page' : undefined}>{t.t('iot.allKinds')}</a>
            {ALERT_KINDS.map((k) => (
              <a key={k} href={q({ kind: k })} className={`kv-tab${k === kind ? ' kv-tab--active' : ''}`} aria-current={k === kind ? 'page' : undefined}>{t.t(`iot.kind.${k}`)}</a>
            ))}
          </nav>
          <nav className="kv-tabs" aria-label={t.t('iot.filterSeverity')}>
            <a href={q({ severity: undefined })} className={`kv-tab${!severity ? ' kv-tab--active' : ''}`} aria-current={!severity ? 'page' : undefined}>{t.t('iot.allSeverities')}</a>
            {ALERT_SEVERITIES.map((s) => (
              <a key={s} href={q({ severity: s })} className={`kv-tab${s === severity ? ' kv-tab--active' : ''}`} aria-current={s === severity ? 'page' : undefined}>{t.t(`iot.severity.${s}`)}</a>
            ))}
            <a href={q({ unack: unacknowledgedOnly ? undefined : '1' })} className={`kv-tab${unacknowledgedOnly ? ' kv-tab--active' : ''}`} aria-current={unacknowledgedOnly ? 'page' : undefined}>
              {t.t('iot.onlyUnacknowledged')}
            </a>
          </nav>

          <DataTable
            rows={rows}
            empty={t.t('iot.alertsEmpty')}
            columns={[
              { header: t.t('iot.colWhen'), cell: (a) => (a.firedAt ? formatDate(a.firedAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash')) },
              {
                header: t.t('iot.colSeverity'),
                cell: (a) => (a.severity === 'critical'
                  ? <strong className="kv-amount--debit">{t.t('iot.severity.critical')}</strong>
                  : <span className="kv-badge">{t.t(`iot.severity.${a.severity}`) || String(a.severity ?? '')}</span>),
              },
              { header: t.t('iot.colKind'), cell: (a) => t.t(`iot.kind.${a.kind}`) || String(a.kind ?? '') },
              { header: t.t('iot.colWhat'), cell: (a) => a.title ?? t.t('common.dash') },
              { header: t.t('iot.colSubject'), cell: (a) => (a.subjectRef ? a.subjectRef : t.t('iot.noSubject')) },
              {
                header: t.t('iot.colAck'),
                cell: (a) => (needsAck(a) ? (
                  <form action={acknowledgeAlertAction} className="kv-inline-form">
                    <input type="hidden" name="id" value={a.id ?? ''} />
                    <button type="submit" className="kv-btn kv-btn--sm">{t.t('iot.ackBtn')}</button>
                  </form>
                ) : (
                  <span className="kv-notif-meta">{t.t('iot.ackedAt', { at: a.acknowledgedAt ? formatDate(a.acknowledgedAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '' })}</span>
                )),
              },
            ]}
          />

          <div className="kv-actions">
            <form action={evaluateNowAction} className="kv-inline-form">
              <button type="submit" className="kv-btn kv-btn--muted">{t.t('iot.evaluateBtn')}</button>
            </form>
          </div>
          <p className="kv-field__hint">{t.t('iot.evaluateHint')}</p>
          <p className="kv-field__hint kv-note">{t.t('iot.ackNote')}</p>
        </>
      )}
    </section>
  );
}
