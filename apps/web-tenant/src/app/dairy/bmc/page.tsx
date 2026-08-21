// apps/web-tenant/src/app/dairy/bmc/page.tsx · W170 (BMC monitor) — PC-56 TENANT-6d-1.
// Server-first, requireSession-gated, noindex. The tank and the window ride in the URL, so an operator can bookmark
// last night's incident and the Back button works.
//
// **`bmc_units` HAS BEEN IN THE SCHEMA SINCE MIGRATION 0009 WITH NO CODE AT ALL** — no repository, no service, no
// route. A cooperative could not record the tank its members' milk sits in for six hours, and TENANT-6a's counter board
// printed `no unit` for every centre, accurately. This is the first surface for it, and the dairy sub-nav's BMC entry.
//
// WHAT THIS PAGE SAYS THAT W170 CANNOT:
//   • **a silent sensor is not a cold tank.** *"Sensors buffer locally; a gap is a connectivity issue, not a temperature
//     unknown"* — so a stale tile leads with the GAP and its age, and the number goes grey rather than standing in for
//     the present;
//   • **the compressor is somebody's word.** Nothing on this platform senses one, so `unknown` is what most tanks show
//     and *"healthy"* appears only where an operator said it;
//   • **the playbook is human.** Every step names its threshold from THIS tenant's settings (not the canon's 7.5/8.0)
//     and says that this platform performs none of them: a diversion moves 87 memberships to another centre, which is
//     TENANT-6d-2's surface, and the union pickup is a phone call;
//   • **the quarter's *"0 L milk lost"* is not measurable here.** Nothing ties a breach to a quantity written off, so
//     the tile says what it would need rather than printing a zero that reads as a guarantee;
//   • **and the promise this screen is really about — a phone ringing — was broken platform-wide.** `ops.alert_fired`
//     has had a notification-map row since PC-55 and no catalogued event, so every ops alert (cold-chain, silent
//     sensor, overdue machine) was counted by a metric and delivered to nobody. This wave seeds it; the screen READS
//     whether the catalogue row is there, so a deployment that has not run the seed says so instead of promising a call.
//     What remains unbuildable from here: `ops_alert_rules` measures silence in WHOLE HOURS, so W170's fifteen minutes
//     cannot be expressed by any rule a tenant could write.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyBmcMonitor } from '@krishalaya/sdk-js';
import {
  alertingKey, alertingTone, bmcHref, bmcState, bmcStateKey, chartPath, compressorKey, compressorTone, fillText,
  litresLostKey, playbookNoteKey, playbookStepKey, readingSourceKey, silenceGapKey, tempIsCurrent, tileHeadlineKey,
  tileTone, timeInRangeText,
  // PC-56 TENANT-6d-4 · W2517–W2520's chain, which is now the only way to register a cooler.
  BMC_NEW_HREF,
  // PC-56 TENANT-6d-5 · W170's call, and the two alerting truths behind its automatic twin.
  callHref, callOfferKey, quietHoursKey,
} from '../../../features/dairy/bmc';
import { DAIRY_NAV, dairyNavLabelKey, dairyUnbuiltCount } from '../../../features/dairy/nav';
// PC-56 TENANT-6d-6 · the playbook's second step, finally an act.
import { divertHref, unionPickupGapKey } from '../../../features/dairy/diversion';
import { recordBmcReadingAction, reportBmcLevelAction, setBmcBandAction, stateBmcCompressorAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.bmc.title'), robots: { index: false, follow: false } };
}

const TONE: Record<'ok' | 'bad' | 'warn' | 'muted', string> = {
  ok: 'kv-badge', bad: 'kv-badge kv-badge--danger', warn: 'kv-badge kv-badge--warn', muted: 'kv-badge kv-badge--muted',
};

export default async function DairyBmcPage({ searchParams }: {
  searchParams: { unit?: string; hours?: string; ok?: string; error?: string };
}) {
  await requireSession('/dairy/bmc');
  const t = getTranslator();
  const lang = getLang();
  const unitId = /^[0-9a-f-]{36}$/i.test(searchParams.unit ?? '') ? searchParams.unit : undefined;
  const hours = Math.min(Math.max(Number(searchParams.hours ?? 6) || 6, 1), 168);

  let view: DairyBmcMonitor | null = null;
  let state = 'ok' as ReturnType<typeof bmcState>;
  try {
    view = await tenantClient().dairy.bmcMonitor({ unitId, hours });
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = bmcState(err?.code ?? 'generic', err?.status);
  }

  const focusTile = view?.units.find((u) => u.unitId === view?.focus?.unitId) ?? null;
  const chart = view?.focus ? chartPath(view.focus.points) : null;

  return (
    <section>
      <h1>{t.t('dairy.bmc.title')}</h1>
      <p className="kv-field__hint">{t.t('dairy.bmc.lead')}</p>

      <nav className="kv-tabs" aria-label={t.t('dairy.nav.label')}>
        {DAIRY_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'bmc' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'bmc' ? 'page' : undefined}>
            {t.t(dairyNavLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(dairyNavLabelKey(i))}</span>
        )))}
      </nav>
      <p className="kv-field__hint">{t.t('dairy.nav.unbuilt')} {formatNumber(dairyUnbuiltCount(), lang)}</p>

      {searchParams.ok && <div className="kv-card kv-card--notice" role="status"><p>{t.t(`dairy.bmc.ok.${searchParams.ok}`)}</p></div>}
      {searchParams.error && <div className="kv-error" role="alert"><p>{t.t('dairy.bmc.error.act')} {searchParams.error}</p></div>}

      {state !== 'ok' || !view ? (
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(bmcStateKey(state))}</p>
          {state === 'error' && (
            <>
              {/* W170's own error copy: sensors buffer locally, so a failed read loses nothing. */}
              <p className="kv-field__hint">{t.t('dairy.bmc.buffersLocally')}</p>
              <p><Link href={BMC_RETRY} className="kv-btn--link">{t.t('dairy.retry')}</Link></p>
            </>
          )}
        </div>
      ) : view.units.length === 0 ? (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('dairy.bmc.empty.noUnits')}</p>
          <p className="kv-field__hint">{t.t('dairy.bmc.empty.registerHint')}</p>
          <p><Link href={BMC_NEW_HREF} className="kv-btn">{t.t('form.bmc.add')}</Link></p>
        </div>
      ) : (
        <>
          {/* ---- the header badge: how many tanks are above their band RIGHT NOW ---- */}
          <p>
            {view.aboveBand > 0
              ? <span className="kv-badge kv-badge--danger">{formatNumber(view.aboveBand, lang)} {t.t('dairy.bmc.header.aboveBand')}</span>
              : <span className="kv-badge">{t.t('dairy.bmc.header.allInRange')}</span>}
            {' '}<span className="kv-field__hint">{t.t('dairy.bmc.header.asOf')} {formatDate(view.now, lang)}</span>
          </p>

          {/* ---- one tile per tank ---- */}
          <div className="kv-stats">
            {view.units.map((u) => (
              <div key={u.unitId} className="kv-stat">
                <span className="kv-stat__label">{u.mccCode} · {u.mccName}</span>
                <strong className={tempIsCurrent(u) ? 'kv-stat__value' : 'kv-stat__value kv-field__hint'}>
                  {u.tempC === null ? t.t('common.dash') : `${u.tempC}°C`}
                </strong>
                <span className={TONE[tileTone(u)]}>{t.t(tileHeadlineKey(u))}</span>
                {u.telemetry.state === 'stale' && u.telemetry.ageMinutes !== null && (
                  <span className="kv-field__hint">
                    {t.t('dairy.bmc.tile.lastSeen')} {formatNumber(u.telemetry.ageMinutes, lang)} {t.t('dairy.bmc.tile.minutesAgo')}
                    {' · '}{t.t('dairy.bmc.tile.gapAfter')} {formatNumber(u.telemetry.silenceMinutes, lang)}
                  </span>
                )}
                <span className="kv-field__hint">
                  {t.t('dairy.bmc.tile.band')} {u.band.minC}–{u.band.maxC}°C ({t.t('dairy.bmc.tile.target')} {u.band.targetC})
                </span>
                <span className="kv-field__hint">
                  {u.capacityLitres} {t.t('dairy.litres')} {t.t('dairy.bmc.tile.capacity')}
                  {fillText(u) ? <> · {formatNumber(fillText(u)!.pct, lang)}% {t.t('dairy.bmc.tile.full')}</> : <> · {t.t('dairy.bmc.tile.levelUnknown')}</>}
                </span>
                <span className={TONE[compressorTone(u)]}>{t.t(compressorKey(u))}</span>
                <span className="kv-field__hint">
                  {t.t(readingSourceKey(u))}
                  {' · '}{formatNumber(u.readings24h, lang)} {t.t('dairy.bmc.tile.readings24h')}
                  {u.breaches24h > 0 && <> · {formatNumber(u.breaches24h, lang)} {t.t('dairy.bmc.tile.breaches24h')}</>}
                </span>
                <span className="kv-field__hint">
                  <Link href={bmcHref(u.unitId, hours)} className="kv-btn--link">{t.t('dairy.bmc.tile.open')}</Link>
                  {/* W170's *"Call MCC-AND-03 operator"* — per TANK, because the canon's button names the warm one and
                      an operator looking at three tiles should not have to navigate to reach the right centre. Offered
                      only when the act is switched on: a link to a route a flag hides is a 404 that reads as a bug. */}
                  {view.callEnabled && (
                    <> {' · '}<Link href={callHref(u.unitId)} className="kv-btn--link">{t.t('dairy.bmc.tile.call')}</Link></>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* ---- the focus tank: its chart, and its playbook ---- */}
          {view.focus && focusTile && (
            <>
              <h2>{focusTile.mccCode} · {t.t('dairy.bmc.chart.heading')} {formatNumber(view.focus.hours, lang)}{t.t('dairy.bmc.chart.hoursShort')}</h2>
              {chart ? (
                <div className="kv-card">
                  <svg viewBox="0 0 600 150" role="img" width="100%" height="150"
                       aria-label={`${t.t('dairy.bmc.chart.aria')} ${chart.minC}–${chart.maxC}°C`}>
                    <path d={chart.path} fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <p className="kv-field__hint">{chart.minC}°C – {chart.maxC}°C · {formatNumber(view.focus.points.length, lang)} {t.t('dairy.bmc.chart.readings')}</p>
                </div>
              ) : (
                /* One reading cannot be a line: a chart drawn from a single point implies a trend nobody measured. */
                <p className="kv-field__hint">{t.t('dairy.bmc.chart.tooFew')}</p>
              )}

              <h2>{t.t('dairy.bmc.playbook.heading')}</h2>
              <ul>
                {view.focus.playbook.map((p) => (
                  <li key={p.step}>
                    <span className={p.due ? 'kv-badge kv-badge--warn' : 'kv-badge kv-badge--muted'}>
                      {p.due ? t.t('dairy.bmc.playbook.due') : t.t('dairy.bmc.playbook.notYet')}
                    </span>{' '}
                    {t.t(playbookStepKey(p.step))}
                    {p.atDeci !== null && <span className="kv-field__hint"> · {t.t('dairy.bmc.playbook.at')} {(p.atDeci / 10).toFixed(1)}°C</span>}
                    {/* [TENANT-6d-6] STEP 2 IS BUILT NOW — for a cooperative that has the override switched on. The
                        link is offered on the step itself rather than in a button bar, because the playbook is where an
                        operator is reading when the decision arrives, and it carries the focus tank's own centre. */}
                    {p.step === 'divert_next_shift' && p.built && focusTile && (
                      <> {' · '}<Link href={divertHref(focusTile.mccId)} className="kv-btn--link">{t.t('dairy.bmc.playbook.divertAct')}</Link></>
                    )}
                    {p.step === 'test_before_pooling' && !p.built && (
                      <span className="kv-field__hint"> · {t.t(unionPickupGapKey())}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="kv-field__hint">{t.t(playbookNoteKey())}</p>
              {!view.diversionEnabled && <p className="kv-field__hint">{t.t('dairy.bmc.playbook.divertNotEnabled')}</p>}

              {/* ---- the acts, on the focus tank ---- */}
              <div className="kv-card">
                <h3>{t.t('dairy.bmc.acts.heading')}</h3>
                <form action={recordBmcReadingAction}>
                  <input type="hidden" name="unitId" value={view.focus.unitId} />
                  <label className="kv-field">
                    <span>{t.t('dairy.bmc.acts.tempC')}</span>
                    <input name="tempC" inputMode="decimal" required pattern="-?\d{1,3}(\.\d)?" />
                  </label>
                  <button type="submit" className="kv-btn">{t.t('dairy.bmc.acts.recordReading')}</button>
                </form>
                <form action={reportBmcLevelAction}>
                  <input type="hidden" name="unitId" value={view.focus.unitId} />
                  <label className="kv-field">
                    <span>{t.t('dairy.bmc.acts.volumeLitres')}</span>
                    <input name="volumeLitres" inputMode="decimal" required pattern="\d{1,8}(\.\d{1,2})?" />
                  </label>
                  <button type="submit" className="kv-btn">{t.t('dairy.bmc.acts.reportLevel')}</button>
                </form>
                <form action={stateBmcCompressorAction}>
                  <input type="hidden" name="unitId" value={view.focus.unitId} />
                  <label className="kv-field">
                    <span>{t.t('dairy.bmc.acts.compressor')}</span>
                    <select name="state" defaultValue={focusTile.compressor.state}>
                      <option value="healthy">{t.t('dairy.bmc.compressor.healthy')}</option>
                      <option value="attention">{t.t('dairy.bmc.compressor.attention')}</option>
                      <option value="unknown">{t.t('dairy.bmc.compressor.unknown')}</option>
                    </select>
                  </label>
                  <button type="submit" className="kv-btn">{t.t('dairy.bmc.acts.stateCompressor')}</button>
                </form>
                <form action={setBmcBandAction}>
                  <input type="hidden" name="unitId" value={view.focus.unitId} />
                  <label className="kv-field"><span>{t.t('dairy.bmc.acts.minC')}</span><input name="minTempC" defaultValue={focusTile.band.minC} required pattern="-?\d{1,3}(\.\d)?" /></label>
                  <label className="kv-field"><span>{t.t('dairy.bmc.acts.targetC')}</span><input name="targetTempC" defaultValue={focusTile.band.targetC} required pattern="-?\d{1,3}(\.\d)?" /></label>
                  <label className="kv-field"><span>{t.t('dairy.bmc.acts.toleranceC')}</span><input name="toleranceC" defaultValue="0.5" required pattern="\d(\.\d)?" /></label>
                  <button type="submit" className="kv-btn">{t.t('dairy.bmc.acts.setBand')}</button>
                </form>
              </div>
            </>
          )}

          {/* ---- this quarter ---- */}
          <h2>{t.t('dairy.bmc.quarter.heading')}</h2>
          <p>
            {timeInRangeText(view.quarter)
              ? <>
                  <strong>{timeInRangeText(view.quarter)!.pct}%</strong> {t.t('dairy.bmc.quarter.timeInRange')}
                  {' '}<span className="kv-field__hint">
                    ({formatNumber(timeInRangeText(view.quarter)!.readings, lang)} {t.t('dairy.bmc.quarter.readings')}
                    {', '}{formatNumber(view.quarter.units, lang)} {t.t('dairy.bmc.quarter.tanks')})
                  </span>
                </>
              : <span className="kv-field__hint">{t.t('dairy.bmc.quarter.noReadings')}</span>}
          </p>
          <p className="kv-field__hint">{t.t(litresLostKey())}</p>

          {/* ---- who would actually be told ---- */}
          <h2>{t.t('dairy.bmc.alerting.heading')}</h2>
          <p>
            <span className={TONE[alertingTone(view.alerting)]}>{t.t(alertingKey(view.alerting))}</span>
            {' '}<span className="kv-field__hint">
              {formatNumber(view.alerting.breachRules, lang)} {t.t('dairy.bmc.alerting.breachRules')}
              {' · '}{formatNumber(view.alerting.silentRules, lang)} {t.t('dairy.bmc.alerting.silentRules')}
              {' · '}{formatNumber(view.alerting.recipients, lang)} {t.t('dairy.bmc.alerting.recipients')}
            </span>
          </p>
          {silenceGapKey(view.alerting, view.thresholds) && (
            <p className="kv-badge kv-badge--warn">{t.t(silenceGapKey(view.alerting, view.thresholds)!)}</p>
          )}
          {/* TENANT-6d-5: whether a CRITICAL alert may wake anybody at all. Quiet hours suppress every phone channel
              unless the catalogued event is critical, which is the finding this wave opened with. */}
          {quietHoursKey(view.alerting) && (
            <p className="kv-badge kv-badge--warn">{t.t(quietHoursKey(view.alerting)!)}</p>
          )}
          {view.alerting.silenceRuleMinutes !== null && (
            <p className="kv-field__hint">
              {t.t('dairy.bmc.alerting.silenceRuleAt')} {formatNumber(view.alerting.silenceRuleMinutes, lang)}
              {' · '}{t.t('dairy.bmc.alerting.checkedEvery')} {formatNumber(view.alerting.evaluationMinutes, lang)}
            </p>
          )}
          {callOfferKey(view) && <p className="kv-field__hint">{t.t(callOfferKey(view)!)}</p>}
          <p className="kv-field__hint">
            {t.t('dairy.bmc.thresholds.divert')} {view.thresholds.divertC}°C
            {' · '}{t.t('dairy.bmc.thresholds.condemn')} {view.thresholds.condemnC}°C
            {' · '}{t.t('dairy.bmc.thresholds.silence')} {formatNumber(view.thresholds.silenceMinutes, lang)}
          </p>

          {/* ---- another cooler ---- W2517's *"Add BMC"*, reachable from a populated monitor and not only from the
               empty state: a cooperative adds its second tank long after its first. ---- */}
          <p><Link href={BMC_NEW_HREF} className="kv-btn">{t.t('form.bmc.add')}</Link></p>
        </>
      )}
    </section>
  );
}

const BMC_RETRY = '/dairy/bmc';
