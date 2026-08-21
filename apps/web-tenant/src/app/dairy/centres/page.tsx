// apps/web-tenant/src/app/dairy/centres/page.tsx · W171 (MCC centres & memberships) — PC-56 TENANT-6d-2.
// Server-first, requireSession-gated, noindex. `includeInactive` rides in the URL so a secretary chasing the footer's
// shortfall can bookmark the wider view.
//
// `mcc_centres` HAS EXISTED SINCE MIGRATION 0009 AND HAS NEVER HAD A SCREEN. The only surface that could create one was
// the pre-canon operator console; the dairy sub-nav has carried `centres` as `not built` since TENANT-6a. This is it,
// and building it found three things W171 says that the platform could not:
//
//   • **the operator.** `operator_user_id` was written once, at create, defaulted to WHOEVER CREATED THE CENTRE, and
//     could never be changed — so a cooperative whose operator left the village had no way to record who holds 108
//     families' milk now. Custody is a register from this wave (0163), and the default is gone;
//   • **the hours.** *"Evening starts 17:00"* had nowhere to live, which is why TENANT-6a's counter board refuses to
//     print an hour. The refusal is now a function of the centre, and the counter prints the hour where a centre has
//     recorded one;
//   • **the footer's tick.** *"3 centres · 312 memberships total ✓"* is a reconciliation, and it is computed as one:
//     the per-centre counts against an independently counted total, so members routed to a deactivated centre are
//     reported as a shortfall instead of quietly leaving both figures.
//
// AND ONE THING IT DELIBERATELY DOES NOT OFFER: the membership transfer. *"The membership moves centres without losing
// history"* — TENANT-6c-6's bill register prints a bill's centre from the membership's CURRENT `mcc_id`, so the first
// transfer would silently re-attribute every closed fortnight. The move is TENANT-6d-3, with that read fixed first; the
// board names the gap rather than shipping a button that creates it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyCentresConsole } from '@krishalaya/sdk-js';
import {
  CENTRES_HREF, centresHref, centresState, centresStateKey, custodyIsNamed, custodyKey, custodyTone,
  hoursHistoryGapKey, hoursKey, hoursText, preferenceLabelKey, preferenceStateKey, preferenceTone,
  reconciliationKey, reconciliationTone, reliefOperatorGapKey, shareText, statusKey, tankKey, tankTempIsCurrent,
  tankTone, transferGapKey,
} from '../../../features/dairy/centres';
import { DAIRY_NAV, dairyNavLabelKey, dairyUnbuiltCount } from '../../../features/dairy/nav';
import { assignOperatorAction, createCentreAction, releaseOperatorAction, setShiftWindowAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.centres.title'), robots: { index: false, follow: false } };
}

const TONE: Record<'ok' | 'bad' | 'warn' | 'muted', string> = {
  ok: 'kv-badge', bad: 'kv-badge kv-badge--danger', warn: 'kv-badge kv-badge--warn', muted: 'kv-badge kv-badge--muted',
};

export default async function DairyCentresPage({ searchParams }: {
  searchParams: { includeInactive?: string; ok?: string; error?: string };
}) {
  await requireSession(CENTRES_HREF);
  const t = getTranslator();
  const lang = getLang();
  const includeInactive = searchParams.includeInactive === '1';

  let view: DairyCentresConsole | null = null;
  let state = 'ok' as ReturnType<typeof centresState>;
  try {
    view = await tenantClient().dairy.centresConsole({ includeInactive });
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = centresState(err?.code ?? 'generic', err?.status);
  }

  return (
    <section>
      <h1>{t.t('dairy.centres.title')}</h1>
      <p className="kv-field__hint">{t.t('dairy.centres.lead')}</p>

      <nav className="kv-tabs" aria-label={t.t('dairy.nav.label')}>
        {DAIRY_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'centres' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'centres' ? 'page' : undefined}>
            {t.t(dairyNavLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(dairyNavLabelKey(i))}</span>
        )))}
      </nav>
      <p className="kv-field__hint">{t.t('dairy.nav.unbuilt')} {formatNumber(dairyUnbuiltCount(), lang)}</p>

      {searchParams.ok && <div className="kv-card kv-card--notice" role="status"><p>{t.t(`dairy.centres.ok.${searchParams.ok}`)}</p></div>}
      {searchParams.error && <div className="kv-error" role="alert"><p>{t.t('dairy.centres.error.act')} {searchParams.error}</p></div>}

      {state !== 'ok' || !view ? (
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(centresStateKey(state))}</p>
          {/* W171's restricted copy names WHY the assignment is gated, not just that it is. */}
          {state === 'restricted' && <p className="kv-field__hint">{t.t('dairy.centres.state.custodyReason')}</p>}
          {state === 'error' && (
            <>
              {/* W171's own error copy: the counter keeps taking milk whatever this board does. */}
              <p className="kv-field__hint">{t.t('dairy.centres.offlineFirst')}</p>
              <p><Link href={CENTRES_HREF} className="kv-btn--link">{t.t('dairy.retry')}</Link></p>
            </>
          )}
        </div>
      ) : view.centres.length === 0 ? (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('dairy.centres.empty.none')}</p>
          <p className="kv-field__hint">{t.t('dairy.centres.empty.hint')}</p>
          <AddCentreForm t={t} />
        </div>
      ) : (
        <>
          {/* ---- the header: centres, memberships, and what needs somebody to walk to it ---- */}
          <p>
            <strong>{formatNumber(view.reconciliation.centres, lang)}</strong> {t.t('dairy.centres.header.centres')}
            {' · '}<strong>{formatNumber(view.reconciliation.total, lang)}</strong> {t.t('dairy.centres.header.memberships')}
            {view.tanksNeedingAttention > 0 && (
              <> {' '}<span className="kv-badge kv-badge--danger">
                {formatNumber(view.tanksNeedingAttention, lang)} {t.t('dairy.centres.header.tanksWarm')}
              </span></>
            )}
            {' '}<span className="kv-field__hint">{t.t('dairy.centres.header.asOf')} {formatDate(view.now, lang)}</span>
          </p>
          <p className="kv-field__hint">{t.t('dairy.centres.header.memberCodeNote')}</p>

          {/* ---- one card per centre ---- */}
          <div className="kv-stats">
            {view.centres.map((c) => (
              <div key={c.id} className="kv-stat">
                <span className="kv-stat__label">{c.code} · {c.name}</span>

                {/* the operator — a name only where custody is held AND verifiable */}
                <span className={TONE[custodyTone(c.custody)]}>{t.t(custodyKey(c.custody))}</span>
                {custodyIsNamed(c.custody) ? (
                  <span>
                    {c.custody.operatorName}
                    {c.custody.operatorPhoneMasked && <span className="kv-field__hint"> · {c.custody.operatorPhoneMasked}</span>}
                    {c.custody.days !== null && (
                      <span className="kv-field__hint"> · {t.t('dairy.centres.custody.since')} {formatNumber(c.custody.days, lang)} {t.t('dairy.centres.custody.days')}</span>
                    )}
                  </span>
                ) : (
                  <span className="kv-field__hint">{t.t('dairy.centres.custody.noName')}</span>
                )}

                <span className="kv-stat__value">{formatNumber(c.members, lang)}</span>
                <span className="kv-field__hint">{t.t('dairy.centres.row.members')}</span>

                <span className="kv-field__hint">
                  {c.capacityLitresShift
                    ? <>{c.capacityLitresShift} {t.t('dairy.litres')} {t.t('dairy.centres.row.perShift')}</>
                    : t.t('dairy.centres.row.capacityUnknown')}
                </span>

                <span className="kv-field__hint">
                  {c.analyzer.model ?? t.t('dairy.centres.row.analyzerUnknown')}
                  {c.analyzer.serialMasked && <> · {t.t('dairy.centres.row.serial')} {c.analyzer.serialMasked}</>}
                </span>

                {/* the hours — the centre's own, or TENANT-6a's refusal for this centre */}
                <span className="kv-field__hint">
                  {t.t(hoursKey(c.hours))}
                  {hoursText(c.hours.morning) && <> · {t.t('dairy.shift.morning')} {hoursText(c.hours.morning)}</>}
                  {hoursText(c.hours.evening) && <> · {t.t('dairy.shift.evening')} {hoursText(c.hours.evening)}</>}
                </span>

                {/* the status column: the centre, and its tank */}
                <span>
                  <span className={c.isActive ? 'kv-badge' : 'kv-badge kv-badge--muted'}>{t.t(statusKey(c))}</span>
                  {' '}<span className={TONE[tankTone(c.tank)]}>{t.t(tankKey(c.tank))}</span>
                  {tankTempIsCurrent(c.tank) && <span className="kv-field__hint"> · {c.tank.tempC}°C</span>}
                  {c.tank.condition === 'stale' && c.tank.ageMinutes !== null && (
                    <span className="kv-field__hint"> · {formatNumber(c.tank.ageMinutes, lang)} {t.t('dairy.centres.tank.minutesAgo')}</span>
                  )}
                  {c.tank.unitId && (
                    <span className="kv-field__hint"> · <Link href={`/dairy/bmc?unit=${encodeURIComponent(c.tank.unitId)}`} className="kv-btn--link">{t.t('dairy.centres.tank.open')}</Link></span>
                  )}
                </span>

                {/* the acts, per centre */}
                <details>
                  <summary>{t.t('dairy.centres.acts.heading')}</summary>
                  <form action={assignOperatorAction}>
                    <input type="hidden" name="mccId" value={c.id} />
                    <label className="kv-field">
                      <span>{t.t('dairy.centres.acts.operatorUserId')}</span>
                      <input name="operatorUserId" required />
                    </label>
                    <label className="kv-field">
                      <span>{t.t('dairy.centres.acts.reason')}</span>
                      <input name="reason" maxLength={300} />
                    </label>
                    <button type="submit" className="kv-btn">{t.t('dairy.centres.acts.assign')}</button>
                  </form>
                  {c.custody.state !== 'nobody' && (
                    <form action={releaseOperatorAction}>
                      <input type="hidden" name="mccId" value={c.id} />
                      <label className="kv-field">
                        <span>{t.t('dairy.centres.acts.reason')}</span>
                        <input name="reason" maxLength={300} />
                      </label>
                      <button type="submit" className="kv-btn">{t.t('dairy.centres.acts.release')}</button>
                    </form>
                  )}
                  <form action={setShiftWindowAction}>
                    <input type="hidden" name="mccId" value={c.id} />
                    <label className="kv-field">
                      <span>{t.t('dairy.centres.acts.shift')}</span>
                      <select name="shift" defaultValue="morning">
                        <option value="morning">{t.t('dairy.shift.morning')}</option>
                        <option value="evening">{t.t('dairy.shift.evening')}</option>
                      </select>
                    </label>
                    <label className="kv-field"><span>{t.t('dairy.centres.acts.opens')}</span><input name="opens" placeholder="06:00" pattern="([01]\d|2[0-3]):[0-5]\d" /></label>
                    <label className="kv-field"><span>{t.t('dairy.centres.acts.closes')}</span><input name="closes" placeholder="09:00" pattern="([01]\d|2[0-3]):[0-5]\d" /></label>
                    <button type="submit" className="kv-btn">{t.t('dairy.centres.acts.setHours')}</button>
                    <p className="kv-field__hint">{t.t('dairy.centres.acts.clearHint')}</p>
                  </form>
                </details>
              </div>
            ))}
          </div>

          {/* ---- the footer: the tick, earned ---- */}
          <p>
            <span className={TONE[reconciliationTone(view.reconciliation)]}>{t.t(reconciliationKey(view.reconciliation))}</span>
            {' '}<span className="kv-field__hint">
              {formatNumber(view.reconciliation.shown, lang)} / {formatNumber(view.reconciliation.total, lang)}
              {!view.reconciliation.reconciles && <> · {formatNumber(view.reconciliation.unaccounted, lang)} {t.t('dairy.centres.footer.unroutedCount')}</>}
            </span>
            {!includeInactive && !view.reconciliation.reconciles && (
              <> {' '}<Link href={centresHref({ includeInactive: true })} className="kv-btn--link">{t.t('dairy.centres.footer.showInactive')}</Link></>
            )}
          </p>
          {view.custodyGaps.unrecorded + view.custodyGaps.nobody + view.custodyGaps.disagrees > 0 && (
            <p className="kv-field__hint">
              {t.t('dairy.centres.footer.custodyGaps')}
              {' '}{formatNumber(view.custodyGaps.nobody, lang)} {t.t('dairy.centres.custody.nobody')}
              {' · '}{formatNumber(view.custodyGaps.unrecorded, lang)} {t.t('dairy.centres.custody.unrecorded')}
              {view.custodyGaps.disagrees > 0 && <> · {formatNumber(view.custodyGaps.disagrees, lang)} {t.t('dairy.centres.custody.disagrees')}</>}
            </p>
          )}
          {view.hoursUnrecorded > 0 && (
            <p className="kv-field__hint">{formatNumber(view.hoursUnrecorded, lang)} {t.t('dairy.centres.footer.hoursUnrecorded')}</p>
          )}

          {/* ---- membership preferences, told from the cycles that exist ---- */}
          <h2>{t.t('dairy.centres.pref.heading')}</h2>
          <ul>
            {view.preferences.map((p) => (
              <li key={p.paymentCycle}>
                <strong>{formatNumber(p.members, lang)}</strong> {t.t(preferenceLabelKey(p))}
                {shareText(p.shareBp) && <span className="kv-field__hint"> · {shareText(p.shareBp)}%</span>}
                {' '}<span className={TONE[preferenceTone(p)]}>{t.t(preferenceStateKey(p))}</span>
                {p.window && (
                  <span className="kv-field__hint">
                    {' · '}{formatDate(p.window.from, lang)} – {formatDate(p.window.to, lang)}
                    {' · '}{t.t('dairy.centres.pref.pays')} {formatDate(p.window.payday, lang)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!view.honoured.all && (
            <p className="kv-badge kv-badge--warn">
              {t.t('dairy.centres.pref.pendingWarn')} {view.honoured.pending.map((c) => t.t(`dairy.cycleName.${c}`)).join(', ')}
            </p>
          )}

          {/* ---- add a centre ---- */}
          <h2>{t.t('dairy.centres.add.heading')}</h2>
          <AddCentreForm t={t} />

          {/* ---- what this board still cannot do ---- */}
          <h2>{t.t('dairy.centres.gap.heading')}</h2>
          <ul>
            <li className="kv-field__hint">{t.t(transferGapKey())}</li>
            <li className="kv-field__hint">{t.t(hoursHistoryGapKey())}</li>
            <li className="kv-field__hint">{t.t(reliefOperatorGapKey())}</li>
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * W171's *"Add centre"*, and its empty state's *"the dairy module activates with your first MCC — analyzer + BMC +
 * operator"*.
 *
 * THE OPERATOR FIELD IS OPTIONAL AND SAYS SO. The API used to default it to the caller; a form that made it required
 * would push a cooperative into naming a custodian before they have chosen one, and the honest state — nobody holds it
 * yet — is one the board can show.
 */
function AddCentreForm({ t }: { t: ReturnType<typeof getTranslator> }) {
  return (
    <form action={createCentreAction} className="kv-card">
      <label className="kv-field"><span>{t.t('dairy.centres.add.code')}</span><input name="code" required maxLength={40} /></label>
      <label className="kv-field"><span>{t.t('dairy.centres.add.name')}</span><input name="defaultName" required maxLength={150} /></label>
      <label className="kv-field"><span>{t.t('dairy.centres.add.capacity')}</span><input name="capacityLitresShift" inputMode="decimal" pattern="\d{1,8}(\.\d{1,2})?" /></label>
      <label className="kv-field"><span>{t.t('dairy.centres.add.analyzerModel')}</span><input name="analyzerModel" maxLength={100} /></label>
      <label className="kv-field"><span>{t.t('dairy.centres.add.analyzerSerial')}</span><input name="analyzerSerial" maxLength={100} /></label>
      <label className="kv-field"><span>{t.t('dairy.centres.add.operator')}</span><input name="operatorUserId" /></label>
      <p className="kv-field__hint">{t.t('dairy.centres.add.operatorOptional')}</p>
      <button type="submit" className="kv-btn">{t.t('dairy.centres.add.submit')}</button>
    </form>
  );
}
