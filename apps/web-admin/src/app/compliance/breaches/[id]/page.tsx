// apps/web-admin/src/app/compliance/breaches/[id]/page.tsx · DPDP §8 breach detail + lifecycle. Server component:
// requireAdmin gates, fetches GET /v1/compliance/breaches/:id (404 → notFound). Lifecycle actions (contain →
// notify → close) are surfaced only when legal (features/compliance mirrors the breach.state machine); "notify"
// requires BOTH the regulator- and principals-notified timestamps (DPDP §8). Each is a Server-Action form with a
// mandatory audit note; admin-api requires compliance.manage + FIDO2 + step-up, so a 403 degrades to a re-auth
// notice. Categories only — no raw PII. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { breachStatusKey, breachSeverityKey, canContainBreach, canNotifyBreach, canCloseBreach, type BreachRow } from '../../../../features/compliance/compliance';
import {
  NOTIFICATION_STEPS, stepState, stepClass, notifyOfferable, notifyBlockedKey, signOffOfferable,
  clockClass, clockKey, reachShortfall,
  type ChecklistLine, type Notifiable, type NotifyClock,
} from '../../../../features/compliance/breach-notification';
import { adminUserId } from '../../../../lib/admin-auth';
import { updateBreachAction, recordBreachStepAction, signOffBreachAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('compliance.breachDetailTitle'), robots: { index: false, follow: false } };
}

const SEV_CLASS: Record<string, string> = { low: 'kv-status--muted', medium: 'kv-status--warn', high: 'kv-status--danger', critical: 'kv-status--danger' };
const OK = new Set(['contain', 'notify', 'close', 'stepRecorded', 'signedOff']);
const ERR = new Set([
  'action', 'note', 'notifiedAt', 'step', 'outcome', 'evidenceRef', 'reachedCount', 'looksLikePii',
  'notEvidenced', 'signOffRequired', 'secondPerson', 'stepNotFound',
  'elevation', 'conflict', 'invalid', 'notFound', 'generic',
]);

interface NotificationView {
  checklist: ChecklistLine[];
  signedOffBy: string | null; signedOffAt: string | null; dpoNote: string | null; openedBy: string | null;
  notifyClock: NotifyClock; containmentMinutes: number | null;
  affectedCount: number | null; reached: number | null; unreached: number | null;
  notifiable: Notifiable;
}

export default async function BreachDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let breach: BreachRow | undefined; let notice: string | undefined;
  try { breach = (await adminGet<BreachRow>(`compliance/breaches/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  // The checklist degrades independently of the breach itself (Law 12): the incident record is what somebody came for.
  let nv: NotificationView | undefined;
  try { nv = (await adminGet<NotificationView>(`compliance/breaches/${encodeURIComponent(params.id)}/notification`)).data; }
  catch { /* the lifecycle below still renders; the checklist section says it could not be read */ }

  if (!breach) {
    return <section><p className="kv-backlink"><Link href="/compliance/breaches">{t.t('compliance.backBreaches')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  // DISPLAY GATING ONLY — the unverified `sub` claim. `ck_breach_signoff_ne_opener` and the service both refuse.
  const viewerId = adminUserId();
  const notifyOK = notifyOfferable(nv?.notifiable);
  const blockedKey = notifyBlockedKey(nv?.notifiable);
  const shortfall = reachShortfall(nv?.affectedCount, nv?.reached);

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const sev = breachSeverityKey(breach.severity);
  const st = breachStatusKey(breach.status);

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance/breaches">{t.t('compliance.backBreaches')}</Link></p>
      <h1>{breach.title}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`compliance.breachOk.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`compliance.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('compliance.severity')}</dt><dd><span className={`kv-status ${SEV_CLASS[sev]}`}>{t.t(`compliance.sev.${sev}`)}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.status')}</dt><dd>{t.t(`compliance.breachState.${st}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.affectedTenant')}</dt><dd>{breach.affectedTenantId ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.affectedCount')}</dt><dd>{breach.affectedCount.toLocaleString()}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.detectedAt')}</dt><dd>{breach.detectedAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.containedAt')}</dt><dd>{breach.containedAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.regulatorNotifiedAt')}</dt><dd>{breach.regulatorNotifiedAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.principalsNotifiedAt')}</dt><dd>{breach.principalsNotifiedAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.closedAt')}</dt><dd>{breach.closedAt ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('compliance.resolutionNote')}</dt><dd>{breach.resolutionNote ?? t.t('common.dash')}</dd></div>
      </dl>

      <h2>{t.t('bn.clockHeading')}</h2>
      {!nv ? <p className="kv-error" role="alert">{t.t('bn.unavailable')}</p> : (
        <>
          <dl className="kv-facts">
            <div className="kv-facts__row">
              <dt>{t.t('bn.notifyWindow')}</dt>
              {/* The clock runs from DETECTION and does NOT stop at containment — containing fast is a different
                  achievement, and stopping the clock there would let a contained-but-unreported breach show green. */}
              <dd><span className={clockClass(nv.notifyClock)}>{t.t(`bn.clock.${clockKey(nv.notifyClock)}`)}</span></dd>
            </div>
            {nv.containmentMinutes !== null && (
              <div className="kv-facts__row"><dt>{t.t('bn.contained')}</dt><dd>{t.t('bn.containedIn', { n: String(nv.containmentMinutes) })}</dd></div>
            )}
            <div className="kv-facts__row">
              <dt>{t.t('bn.reach')}</dt>
              {/* NULL is not zero. A fabricated "0 unreached" converts "nobody counted" into "everybody was told". */}
              <dd>{shortfall.known ? t.t('bn.reachLine', { reached: String(nv.reached ?? 0), affected: String(nv.affectedCount ?? 0), missing: String(shortfall.missing) }) : t.t('bn.reachUnknown')}</dd>
            </div>
            {nv.signedOffBy && (
              <div className="kv-facts__row"><dt>{t.t('bn.signedOff')}</dt><dd>{nv.signedOffBy} · {nv.signedOffAt}{nv.dpoNote ? ` — ${nv.dpoNote}` : ''}</dd></div>
            )}
          </dl>

          <h2>{t.t('bn.checklistHeading')}</h2>
          <p className="kv-muted">{t.t('bn.checklistLead')}</p>
          <ul className="kv-list">
            {nv.checklist.map((l) => (
              <li key={l.step}>
                <span className={stepClass(l)}>{t.t(`bn.state.${stepState(l)}`)}</span> {t.t(`bn.step.${l.step}`)}
                {l.evidenceRef && <> — <span className="kv-detail__muted">{l.evidenceRef}</span></>}
                {typeof l.reachedCount === 'number' && <> · {t.t('bn.reached', { n: String(l.reachedCount) })}</>}
                {l.channel && <> · {l.channel}</>}
                {l.note && <><br /><span className="kv-detail__muted">{l.note}</span></>}
                {l.performedBy && <><br /><span className="kv-detail__muted">{t.t('bn.by', { who: l.performedBy, when: l.performedAt ?? '' })}</span></>}
              </li>
            ))}
          </ul>

          <h3>{t.t('bn.recordHeading')}</h3>
          {/* One act per call. A "mark all notified" control would recreate the two-typed-timestamps problem. */}
          <form action={recordBreachStepAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={breach.id} />
            <p className="kv-field__hint">{t.t('bn.recordHint')}</p>
            <label className="kv-field__label" htmlFor="step">{t.t('bn.stepLabel')}</label>
            <select id="step" name="step" className="kv-input" defaultValue="board_filing">
              {NOTIFICATION_STEPS.map((x) => <option key={x} value={x}>{t.t(`bn.step.${x}`)}</option>)}
            </select>
            <label className="kv-field__label" htmlFor="outcome">{t.t('bn.outcomeLabel')}</label>
            <select id="outcome" name="outcome" className="kv-input" defaultValue="done">
              <option value="done">{t.t('bn.state.done')}</option>
              <option value="not_applicable">{t.t('bn.state.notApplicable')}</option>
            </select>
            <label className="kv-field__label" htmlFor="evidenceRef">{t.t('bn.evidenceRef')}</label>
            <input id="evidenceRef" name="evidenceRef" className="kv-input" maxLength={200} />
            <p className="kv-field__hint">{t.t('bn.evidenceHint')}</p>
            <label className="kv-field__label" htmlFor="reachedCount">{t.t('bn.reachedCount')}</label>
            <input id="reachedCount" name="reachedCount" className="kv-input kv-input--sm" inputMode="numeric" />
            <p className="kv-field__hint">{t.t('bn.reachedHint')}</p>
            <label className="kv-field__label" htmlFor="channel">{t.t('bn.channel')}</label>
            <input id="channel" name="channel" className="kv-input" maxLength={40} />
            <label className="kv-field__label" htmlFor="stepNote">{t.t('compliance.note')}</label>
            <input id="stepNote" name="note" className="kv-input" maxLength={2000} />
            <button type="submit" className="kv-btn">{t.t('bn.record')}</button>
          </form>

          <h3>{t.t('bn.signOffHeading')}</h3>
          {/* THE FIFTH TWO-PERSON CONTROL. Not offered to whoever declared the breach — they are the person most
              motivated to see the row closed, usually at the worst hour of the night. */}
          {signOffOfferable(nv.openedBy, viewerId, !!nv.signedOffBy) ? (
            <form action={signOffBreachAction} className="kv-card kv-action-card">
              <input type="hidden" name="id" value={breach.id} />
              <p className="kv-field__hint">{t.t('bn.signOffHint')}</p>
              <label className="kv-field__label" htmlFor="dpoNote">{t.t('bn.dpoNote')}</label>
              <input id="dpoNote" name="note" className="kv-input" maxLength={2000} />
              <p className="kv-field__hint">{t.t('bn.dpoNoteOptional')}</p>
              <button type="submit" className="kv-btn">{t.t('bn.signOff')}</button>
            </form>
          ) : (
            <p className="kv-notice">{t.t(nv.signedOffBy ? 'bn.alreadySigned' : 'bn.signOffBlocked')}</p>
          )}
        </>
      )}

      <h2>{t.t('compliance.breachLifecycle')}</h2>
      {canContainBreach(st) || canNotifyBreach(st) || canCloseBreach(st) ? (
        <div className="kv-action-cards">
          {canContainBreach(st) && (
            <form action={updateBreachAction} className="kv-card kv-action-card">
              <input type="hidden" name="id" value={breach.id} /><input type="hidden" name="action" value="contain" />
              <label className="kv-field__label">{t.t('compliance.note')}</label>
              <input name="note" className="kv-input" required minLength={3} maxLength={2000} />
              <button type="submit" className="kv-btn">{t.t('compliance.contain')}</button>
            </form>
          )}
          {/* THE NOTIFY CONTROL IS ABSENT UNTIL THE CHECKLIST IS COMPLETE AND SIGNED.
              Before ADMIN-5c this form was the whole gate: two timestamps an operator typed and the register stated
              that the Data Protection Board had been notified. A button that always 409s would teach an operator the
              checklist is paperwork — which is the attitude that let the timestamps stand in for a statutory act. */}
          {canNotifyBreach(st) && !notifyOK && (
            <p className="kv-notice">{t.t(`bn.notifyBlocked.${blockedKey ?? 'unknown'}`)}</p>
          )}
          {canNotifyBreach(st) && notifyOK && (
            <form action={updateBreachAction} className="kv-card kv-action-card">
              <input type="hidden" name="id" value={breach.id} /><input type="hidden" name="action" value="notify" />
              <p className="kv-field__hint">{t.t('compliance.notifyHint')}</p>
              <label className="kv-field__label">{t.t('compliance.regulatorNotifiedAt')}</label>
              <input name="regulatorNotifiedAt" className="kv-input" required placeholder={t.t('compliance.isoHint')} />
              <label className="kv-field__label">{t.t('compliance.principalsNotifiedAt')}</label>
              <input name="principalsNotifiedAt" className="kv-input" required placeholder={t.t('compliance.isoHint')} />
              <label className="kv-field__label">{t.t('compliance.note')}</label>
              <input name="note" className="kv-input" required minLength={3} maxLength={2000} />
              <button type="submit" className="kv-btn">{t.t('compliance.notify')}</button>
            </form>
          )}
          {canCloseBreach(st) && (
            <form action={updateBreachAction} className="kv-card kv-action-card">
              <input type="hidden" name="id" value={breach.id} /><input type="hidden" name="action" value="close" />
              <label className="kv-field__label">{t.t('compliance.note')}</label>
              <input name="note" className="kv-input" required minLength={3} maxLength={2000} />
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('compliance.close')}</button>
            </form>
          )}
        </div>
      ) : <p className="kv-muted">{t.t('compliance.breachClosed')}</p>}
    </section>
  );
}
