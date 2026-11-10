// apps/web-ops/src/components/ops4/IotViews.tsx · PC-56 OPS-4c · THE SENSORS — the three sensor pages, presentational (W400, W401, W404).
//
// What a person at the field desk SEES, signed in as themself (OPS-3 Q14-A): the subjects the organisation monitors (coolers, reefers, chambers,
// vaccine boxes — the server's `subjects`), each by its type and the server's label (never a person, never a farmer); each reading with ITS
// SOURCE — "from the logger" only when the server says `device`, "typed by a person" when it says `manual` (founder door Q6-A) —, its own time
// named, and its age; the registered loggers by serial; the silences the SERVER flagged, with the server's own threshold; soil pods and weather
// masts as registered, with no readings. What they are TOLD: Q6-A's second and third sentences (the first is NOT printed — its premise is false:
// a signed reading carries the device's own time) and facts the code proves. What they CANNOT DO here: anything — no threshold, no breach act,
// no manual reading, no form but W401's hours window (a GET). Nothing is summed, nothing is drawn between two readings, nothing is "online",
// no battery, no calibration, no "right now". Every refused canon line is printed BY NAME (`Ops4Refusals`).
import Link from 'next/link';
import type { ColdBreach, ColdLogger, ColdOverview, ColdReading, ColdSubjectDetail, ColdSubjectRow } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops4/refusals';
import {
  HOURS_WINDOWS, IOT, atText, byType, deviceHref, minutesBefore, sourceKey, statusKey, tempText, timeKey,
  type IotState, type SubjectType,
} from '../../features/ops4/iot';
import { Ops4Refusals } from './Ops4Chain';

/** The Q6-A sentences printed (the second and the third; the first is stopped — see features/ops4/refusals.ts `q6_first_sentence`). */
export const Q6_PRINTED = ['ops4.q6.typedNotSensor', 'ops4.q6.soilRegistryOnly'] as const;

function Statements({ t, keys, id }: { t: Tr; keys: readonly string[]; id: string }) {
  return (
    <div className="kv-card" data-kv-statement={id}>
      {keys.map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
    </div>
  );
}
function Head({ t, page }: { t: Tr; page: 'dash' | 'device' | 'health' }) {
  return (
    <>
      <h1>{t.t(`ops4.iot.${page}.title`)}</h1>
      <p className="kv-muted" data-kv-statement="ops4.iot.signedIn">{t.t('ops4.iot.signedIn')}</p>
    </>
  );
}
function NotShown({ t, state, page, surface }: { t: Tr; state: 'off' | 'forbidden'; page: 'dash' | 'device' | 'health'; surface: 'iot_dashboard' | 'iot_device' | 'iot_health' }) {
  return (
    <section data-kv-ops4={`iot-${page}`} data-kv-state={state}>
      <Head t={t} page={page} />
      <div className="kv-card" data-kv-off={state === 'off' ? 'logistics' : 'permission'}>
        <h2 className="kv-card__title">{t.t(`ops4.iot.${state}.title`)}</h2><p>{t.t(`ops4.iot.${state}.body`)}</p>
      </div>
      <Ops4Refusals t={t} surface={surface} />
    </section>
  );
}
function ReadError({ t, href }: { t: Tr; href: string }) {
  return (
    <div className="kv-card" role="alert" data-kv-error="read">
      <h2 className="kv-card__title">{t.t('ops4.error.title')}</h2>
      <p>{t.t('ops4.error.body')}</p>
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-chain-link="retry">{t.t('ops4.error.retry')}</Link></p>
    </div>
  );
}
const at = (t: Tr, iso: unknown) => atText(iso) ?? t.t('ops4.iot.timeUnknown');

/** One reading, in words: the temperature as sent, its source, its own time named by its source, and its age. Never "right now". */
export function ReadingLine({ t, tempC, at: when, source, readAt }: { t: Tr; tempC: unknown; at: unknown; source: unknown; readAt: number }) {
  const temp = tempText(tempC);
  const age = minutesBefore(when, readAt);
  return (
    <span data-kv-reading={source === 'device' || source === 'manual' ? source : 'unknown'}>
      {temp === null ? t.t('ops4.iot.tempUnknown') : t.t('ops4.iot.temp', { temp })}
      {' · '}<span className="kv-badge" data-kv-source={String(source ?? 'unknown')}>{t.t(sourceKey(source))}</span>
      {' · '}{t.t(timeKey(source), { at: at(t, when) })}
      {age === null ? null : <>{' · '}<span data-kv-age={age}>{t.t('ops4.iot.age', { minutes: age })}</span></>}
    </span>
  );
}

// ══ W400 · /iot/dashboard ══
export interface IotDashboardProps {
  t: Tr; state: IotState; readAt: number; overview: ColdOverview | null; lastBreach: ColdBreach | null | 'failed';
  loggers: readonly ColdLogger[] | null; registry: { soilPods: number; weatherMasts: number } | null;
}
export function IotDashboardView({ t, state, readAt, overview, lastBreach, loggers, registry }: IotDashboardProps) {
  if (state === 'off' || state === 'forbidden') return <NotShown t={t} state={state} page="dash" surface="iot_dashboard" />;
  const groups = byType<ColdSubjectRow>(overview?.items ?? []);
  return (
    <section data-kv-ops4="iot-dash" data-kv-state={state}>
      <Head t={t} page="dash" />
      <Statements t={t} id="iot-dash" keys={Q6_PRINTED} />
      {state === 'error' || !overview ? <ReadError t={t} href={`${IOT.dashboard}?act=confirm`} /> : (
        <>
          <h2>{t.t('ops4.iot.dash.subjects')}</h2>
          {groups.length === 0 ? <p className="kv-empty-state" data-kv-empty="subjects">{t.t('ops4.iot.dash.subjectsNone')}</p> : groups.map((g) => (
            <div key={g.type} className="kv-card" data-kv-subject-type={g.type}>
              <h3 className="kv-card__title">{t.t(`ops4.iot.type.${g.type}`)}</h3>
              <ul className="kv-list">
                {g.rows.map((r) => (
                  <li key={`${r.subjectType}:${r.subjectId}`} data-kv-subject={r.subjectId} data-kv-status={r.status}>
                    <Link className="kv-link" href={deviceHref(r.subjectType as SubjectType, r.subjectId)} data-kv-edge="W401">{r.label}</Link>
                    {' · '}<span className="kv-badge">{t.t(statusKey(r.status))}</span>
                    <br />
                    {r.now ? <ReadingLine t={t} tempC={r.now.tempC} at={r.now.at} source={r.now.source} readAt={readAt} />
                      : <span data-kv-reading="none">{t.t('ops4.iot.noReading')}</span>}
                    <br />
                    <span className="kv-muted" data-kv-logger={r.device ? r.device.id : 'none'}>
                      {r.device ? t.t('ops4.iot.loggerSerial', { serial: r.device.serial ?? t.t('ops4.iot.serialUnknown') }) : t.t('ops4.iot.noLogger')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <h2>{t.t('ops4.iot.dash.breaches')}</h2>
          <p data-kv-breaches7d={overview.breaches7d}>{t.t('ops4.iot.dash.breaches7d', { n: overview.breaches7d })}</p>
          {lastBreach === 'failed' ? <p className="kv-error" role="alert" data-kv-error="breaches">{t.t('ops4.iot.dash.lastBreachFailed')}</p>
            : lastBreach === null ? <p className="kv-empty-state" data-kv-empty="breach">{t.t('ops4.iot.dash.noBreach')}</p> : (
              <p data-kv-last-breach={lastBreach.id}>
                {t.t('ops4.iot.dash.lastBreach', { type: t.t(`ops4.iot.type.${lastBreach.subjectType}`), ref: lastBreach.subjectRef, opened: at(t, lastBreach.openedAt) })}
                {' '}{lastBreach.closedAt ? t.t('ops4.iot.breachClosed', { at: at(t, lastBreach.closedAt) }) : t.t('ops4.iot.breachOpen')}
              </p>
            )}
          <p className="kv-muted" data-kv-statement="ops4.iot.breachRule">{t.t('ops4.iot.breachRule')}</p>
          <h2>{t.t('ops4.iot.dash.loggers')}</h2>
          {loggers === null ? <p className="kv-error" role="alert" data-kv-error="loggers">{t.t('ops4.iot.dash.loggersFailed')}</p>
            : loggers.length === 0 ? <p className="kv-empty-state" data-kv-empty="loggers">{t.t('ops4.iot.dash.loggersNone')}</p> : (
              <ul className="kv-list" data-kv-loggers="registered">
                {loggers.map((l) => (
                  <li key={l.deviceId} data-kv-logger-row={l.deviceId} data-kv-logger-status={l.status}>
                    {t.t('ops4.iot.loggerSerial', { serial: l.serial })}{' · '}{t.t(l.status === 'registered' ? 'ops4.iot.logger.registered' : 'ops4.iot.logger.retired')}
                    {' · '}{l.lastReadingAt ? t.t('ops4.iot.lastSigned', { at: at(t, l.lastReadingAt) }) : t.t('ops4.iot.neverSigned')}
                    {' · '}{l.key ? t.t('ops4.iot.mountedOn', { type: t.t(`ops4.iot.type.${l.key.subjectType}`) }) : t.t('ops4.iot.noKey')}
                  </li>
                ))}
              </ul>
            )}
          {registry ? (
            <div className="kv-card" data-kv-registry="twin">
              <h2 className="kv-card__title">{t.t('ops4.iot.dash.field')}</h2>
              <p data-kv-soil-pods={registry.soilPods}>{t.t('ops4.iot.soilPods', { n: registry.soilPods })}</p>
              <p data-kv-weather-masts={registry.weatherMasts}>{t.t('ops4.iot.weatherMasts', { n: registry.weatherMasts })}</p>
            </div>
          ) : null}
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={IOT.health} data-kv-edge="W404">{t.t('ops4.iot.openHealth')}</Link></p>
        </>
      )}
      <Ops4Refusals t={t} surface="iot_dashboard" />
    </section>
  );
}

// ══ W401 · /iot/device?type=&id=&hours= ══
export interface IotDeviceProps { t: Tr; state: IotState | 'notFound'; readAt: number; hours: number; type: SubjectType | null; id: string | null; detail: ColdSubjectDetail | null }
export function IotDeviceView({ t, state, readAt, hours, type, id, detail }: IotDeviceProps) {
  if (state === 'off' || state === 'forbidden') return <NotShown t={t} state={state} page="device" surface="iot_device" />;
  const self = type && id ? deviceHref(type, id, hours) : IOT.device;
  const sep = self.includes('?') ? '&' : '?';
  return (
    <section data-kv-ops4="iot-device" data-kv-state={state}>
      <Head t={t} page="device" />
      <Statements t={t} id="iot-device" keys={['ops4.q6.typedNotSensor']} />
      {state === 'notFound' || (state === 'ok' && !detail) ? (
        <div className="kv-empty-state" data-kv-empty="subject"><h2>{t.t('ops4.iot.device.notFound.title')}</h2><p>{t.t('ops4.iot.device.notFound.body')}</p></div>
      ) : state === 'error' || !detail ? <ReadError t={t} href={`${self}${sep}act=confirm`} /> : (
        <>
          <h2 data-kv-subject={detail.subjectId}>{t.t('ops4.iot.device.subject', { type: t.t(`ops4.iot.type.${detail.subjectType}`), label: detail.label })}</h2>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('ops4.iot.device.status')}</dt><dd><span className="kv-badge">{t.t(statusKey(detail.status))}</span></dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops4.iot.device.band')}</dt><dd data-kv-band={detail.band ? `${detail.band.minC}|${detail.band.maxC}` : 'none'}>
              {detail.band ? t.t('ops4.iot.bandText', { min: detail.band.minC, max: detail.band.maxC }) : t.t('ops4.iot.noBand')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ops4.iot.device.logger')}</dt><dd data-kv-logger={detail.device ? detail.device.id : 'none'}>
              {detail.device ? t.t('ops4.iot.loggerSerial', { serial: detail.device.serial ?? t.t('ops4.iot.serialUnknown') }) : t.t('ops4.iot.noLogger')}</dd></div>
          </dl>
          {detail.playbook?.rule === 'two_consecutive_device_readings' && detail.playbook.manualNeverOpens
            ? <p className="kv-statement" data-kv-statement="ops4.iot.breachRule">{t.t('ops4.iot.breachRule')}</p> : null}
          <form method="get" action={IOT.device} className="kv-form" data-kv-filter="hours">
            <input type="hidden" name="type" value={detail.subjectType} />
            <input type="hidden" name="id" value={detail.subjectId} />
            <label className="kv-field">{t.t('ops4.iot.device.window')}
              <select name="hours" defaultValue={String(hours)}>
                {HOURS_WINDOWS.map((h) => <option key={h} value={String(h)}>{t.t('ops4.iot.device.windowHours', { h })}</option>)}
              </select>
            </label>
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('ops4.iot.device.show')}</button>
          </form>
          <h2>{t.t('ops4.iot.device.trail', { h: detail.windowHours })}</h2>
          <p className="kv-muted" data-kv-statement="ops4.iot.device.pointsOnly">{t.t('ops4.iot.device.pointsOnly')}</p>
          {detail.trail.length === 0 ? <p className="kv-empty-state" data-kv-empty="trail">{t.t('ops4.iot.device.trailNone', { h: detail.windowHours })}</p> : (
            <ol className="kv-list" data-kv-trail={detail.trail.length}>
              {detail.trail.map((r: ColdReading, i: number) => (
                <li key={r.id ?? `p${i}`} data-kv-point={r.source} data-kv-excursion={r.excursion === true ? 'yes' : r.excursion === false ? 'no' : 'unknown'}>
                  {tempText(r.tempC) === null ? t.t('ops4.iot.tempUnknown') : t.t('ops4.iot.temp', { temp: tempText(r.tempC) as string })}
                  {' · '}<span className="kv-badge" data-kv-source={r.source}>{t.t(sourceKey(r.source))}</span>
                  {' · '}{t.t(timeKey(r.source), { at: at(t, r.recordedAt) })}
                  {' · '}{t.t('ops4.iot.received', { at: at(t, r.serverRecordedAt) })}
                  {' · '}{t.t(r.excursion === true ? 'ops4.iot.outside' : r.excursion === false ? 'ops4.iot.inside' : 'ops4.iot.noBandAtWrite')}
                </li>
              ))}
            </ol>
          )}
          {detail.nextCursor ? <p className="kv-muted" data-kv-note="trail-more">{t.t('ops4.iot.device.trailMore', { n: detail.trail.length })}</p> : null}
          <h2>{t.t('ops4.iot.device.breaches')}</h2>
          {detail.breaches.length === 0 ? <p className="kv-empty-state" data-kv-empty="breaches">{t.t('ops4.iot.device.breachesNone')}</p> : (
            <ul className="kv-list" data-kv-breaches={detail.breaches.length}>
              {detail.breaches.map((b) => (
                <li key={b.id} data-kv-breach={b.id}>
                  {t.t('ops4.iot.device.breach', { opened: at(t, b.openedAt), peak: b.peakC, direction: t.t(`ops4.iot.direction.${b.direction}`), n: b.readingsOut })}
                  {' '}{b.closedAt ? t.t('ops4.iot.breachClosed', { at: at(t, b.closedAt) }) : t.t('ops4.iot.breachOpen')}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={IOT.dashboard} data-kv-edge="W400">{t.t('ops4.iot.backToDash')}</Link></p>
      <Ops4Refusals t={t} surface="iot_device" />
    </section>
  );
}

// ══ W404 · /iot/device-health ══
type Silence = { id: string; deviceId: string; subjectType: string; subjectId: string; lastReadingAt: string; flaggedAt: string; alertState: string; resolvedAt: string | null };
export interface IotHealthProps { t: Tr; state: IotState; silences: readonly Silence[]; loggers: readonly ColdLogger[]; silenceMinutes: number | null }
export function IotHealthView({ t, state, silences, loggers, silenceMinutes }: IotHealthProps) {
  if (state === 'off' || state === 'forbidden') return <NotShown t={t} state={state} page="health" surface="iot_health" />;
  const serialOf = (id: string) => loggers.find((l) => l.deviceId === id)?.serial ?? null;
  return (
    <section data-kv-ops4="iot-health" data-kv-state={state}>
      <Head t={t} page="health" />
      <Statements t={t} id="iot-health" keys={['ops4.q6.typedNotSensor', 'ops4.iot.health.typedNeverEnds']} />
      {state === 'error' ? <ReadError t={t} href={`${IOT.health}?act=confirm`} /> : (
        <>
          {silenceMinutes === null ? null
            : <p className="kv-statement" data-kv-silence-minutes={silenceMinutes}>{t.t('ops4.iot.health.threshold', { minutes: silenceMinutes })}</p>}
          <h2>{t.t('ops4.iot.health.flagged')}</h2>
          {silences.length === 0 ? <p className="kv-empty-state" data-kv-empty="silences">{t.t('ops4.iot.health.none')}</p> : (
            <ul className="kv-list" data-kv-silences={silences.length}>
              {silences.map((s) => (
                <li key={s.id} data-kv-silence={s.id} data-kv-resolved={s.resolvedAt ? 'yes' : 'no'}>
                  {t.t('ops4.iot.loggerSerial', { serial: serialOf(s.deviceId) ?? t.t('ops4.iot.serialUnknown') })}
                  {' · '}{t.t('ops4.iot.mountedOn', { type: t.t(`ops4.iot.type.${s.subjectType}`) })}
                  {' · '}{t.t('ops4.iot.lastSigned', { at: at(t, s.lastReadingAt) })}
                  {' · '}{t.t('ops4.iot.health.flaggedAt', { at: at(t, s.flaggedAt) })}
                  {' · '}{t.t(s.alertState === 'alerted' ? 'ops4.iot.health.alerted' : 'ops4.iot.health.noRecipient')}
                  {' · '}{s.resolvedAt ? t.t('ops4.iot.health.resolvedAt', { at: at(t, s.resolvedAt) }) : t.t('ops4.iot.health.notResolved')}
                  {(['bmc_unit', 'shipment', 'warehouse_chamber', 'vaccine_box'] as const).includes(s.subjectType as SubjectType)
                    ? <>{' · '}<Link className="kv-link" href={deviceHref(s.subjectType as SubjectType, s.subjectId)} data-kv-edge="W401">{t.t('ops4.iot.health.openSubject')}</Link></> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={IOT.dashboard} data-kv-edge="W400">{t.t('ops4.iot.backToDash')}</Link></p>
        </>
      )}
      <Ops4Refusals t={t} surface="iot_health" />
    </section>
  );
}
