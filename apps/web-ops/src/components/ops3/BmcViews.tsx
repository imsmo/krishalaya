// apps/web-ops/src/components/ops3/BmcViews.tsx · PC-56 OPS-3b · THE TANK (W366 + the bmc form chain W3282–W3285), presentational.
//
// Founder 2026-11-08 (`05_OPS.md` "OPS-3 SPLIT"): Q12-A (this console reads the cooler and records manual readings only; "Request tanker dispatch"
// refused by name; the cooler's band, level, compressor and retirement stay on the organisation's console) · Q13-A (the manual reading offered here,
// labelled as manual, with no photo) · Q10-A (no member on this page) · Q14-A ("signed in as you").
//
// NO CLIENT MATH (E3): every figure printed is the server's own string or count — no percentage, average, variance or difference, and nothing drawn
// between two readings (the series is the server's points, one row each). The tile's fill ratio, its sensor serial and its operator id are never
// printed. The ONLY input on the page is the manual reading's temperature (E7). Every refused canon line is printed BY NAME (`Ops3Refusals`).
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DairyBmcMonitor, DairyBmcTile, DairyMcc } from '@krishalaya/sdk-js';
import type { Tr } from '../../features/ops3/refusals';
import { BMC, atText, type BmcScope, type BmcState, type FormError, type ReadingReason, type RecordedReading } from '../../features/ops3/bmc';
import { Ops3Refusals } from './Ops3Chain';
import { ltrText } from '../../features/rtl/span';   // PC-56 RTL-1g: a code inside a sentence, isolated under Arabic only

type Points = NonNullable<DairyBmcMonitor['focus']>['points'];

/** The chrome: "signed in as you" (Q14-A) — never a name from the canon, never a role. */
function BmcChrome({ t }: { t: Tr }) {
  return <p className="kv-muted" data-kv-chrome="bmc"><span data-kv-signed-in="you">{t.t('ops3.bmc.signedIn')}</span></p>;
}

export function BmcStateView({ t, state }: { t: Tr; state: Exclude<BmcState, 'ok'> }) {
  return (
    <div className="kv-card" data-kv-state={state} role={state === 'error' ? 'alert' : 'status'}>
      <h2 className="kv-card__title">{t.t(`ops3.bmc.state.${state}.title`)}</h2>
      <p>{t.t(`ops3.bmc.state.${state}.body`)}</p>
      {/* the read's own error: Retry opens the bmc mutate chain's confirm state, whose one link IS the re-read (PARITY-DECOR, FM:47) */}
      {state === 'error' ? <p className="kv-pager"><Link className="kv-btn" href={`${BMC}?act=confirm`} data-kv-retry="reread">{t.t('ops3.bmc.retry')}</Link></p> : null}
    </div>
  );
}

function Fact({ t, k, children, kv }: { t: Tr; k: string; children: ReactNode; kv: Record<string, string> }) {
  return <div className="kv-facts__row"><dt>{t.t(k)}</dt><dd {...kv}>{children}</dd></div>;
}

/** One cooler, as the monitor reads it. Every value is the server's; the level and the compressor are a person's statements, said so. */
export function CoolerCard({ t, tile, lang = 'en' }: { t: Tr; tile: DairyBmcTile; lang?: string }) {
  const tel = tile.telemetry;
  return (
    <article className="kv-card" data-kv-cooler={tile.unitId} data-kv-telemetry={tel.state}>
      <h2 className="kv-card__title">{t.t('ops3.bmc.cooler', { code: ltrText(tile.mccCode, lang), name: tile.mccName })}</h2>
      {tel.state === 'never' ? <p className="kv-muted" data-kv-telemetry-note="never">{t.t('ops3.bmc.telemetry.never')}</p> : null}
      {tel.state === 'stale' && tel.ageMinutes !== null
        ? <p className="kv-statement" role="status" data-kv-telemetry-note="stale">{t.t('ops3.bmc.telemetry.stale', { minutes: tel.ageMinutes, gap: tel.silenceMinutes })}</p> : null}
      <dl className="kv-facts">
        <Fact t={t} k="ops3.bmc.reading" kv={{ 'data-kv-temp': tile.tempC ?? 'none' }}>{tile.tempC !== null && tel.ageMinutes !== null
          ? t.t('ops3.bmc.readingValue', { temp: tile.tempC, minutes: tel.ageMinutes }) : t.t('ops3.bmc.readingNone')}</Fact>
        <Fact t={t} k="ops3.bmc.verdict" kv={{ 'data-kv-verdict': tile.verdict ?? 'none' }}>{tile.verdict ? t.t(`ops3.bmc.verdict.${tile.verdict}`) : t.t('ops3.bmc.verdictNone')}</Fact>
        <Fact t={t} k="ops3.bmc.band" kv={{ 'data-kv-band': `${tile.band.minC}|${tile.band.maxC}` }}>{t.t('ops3.bmc.bandValue', { min: tile.band.minC, max: tile.band.maxC })}</Fact>
        <Fact t={t} k="ops3.bmc.capacity" kv={{ 'data-kv-capacity': tile.capacityLitres }}>{t.t('ops3.bmc.capacityValue', { capacity: tile.capacityLitres })}</Fact>
        <Fact t={t} k="ops3.bmc.level" kv={{ 'data-kv-level': tile.volumeLitres ?? 'none' }}>{tile.volumeLitres && tile.volumeAt
          ? t.t('ops3.bmc.levelValue', { volume: tile.volumeLitres, at: atText(tile.volumeAt) ?? '' }) : t.t('ops3.bmc.levelNone')}</Fact>
        <Fact t={t} k="ops3.bmc.compressor" kv={{ 'data-kv-compressor': tile.compressor.state }}>{tile.compressor.state === 'unknown' || !tile.compressor.at
          ? t.t('ops3.bmc.compressorNone')
          : t.t('ops3.bmc.compressorValue', { state: t.t(`ops3.bmc.compressor.${tile.compressor.state}`), at: atText(tile.compressor.at) ?? '' })}</Fact>
        <Fact t={t} k="ops3.bmc.counts" kv={{ 'data-kv-counts': `${tile.readings24h}|${tile.breaches24h}` }}>{t.t('ops3.bmc.countsValue', { readings: tile.readings24h, out: tile.breaches24h })}</Fact>
      </dl>
      <p className="kv-muted" data-kv-statement="ops3.bmc.sourceUnknown">{t.t('ops3.bmc.sourceUnknown')}</p>
    </article>
  );
}

/** The series, as the server sent it: one row per recorded reading, oldest first. Nothing is drawn or worked out between two rows. */
export function ReadingSeries({ t, points }: { t: Tr; points: Points | null }) {
  return (
    <article className="kv-card" data-kv-series={points ? points.length : 'none'}>
      <h2 className="kv-card__title">{t.t('ops3.bmc.series.title')}</h2>
      <p className="kv-muted">{t.t('ops3.bmc.series.note')}</p>
      {!points || points.length === 0 ? <p className="kv-muted" data-kv-empty="series">{t.t('ops3.bmc.series.none')}</p> : (
        <table className="kv-table">
          <thead><tr><th scope="col">{t.t('ops3.bmc.series.colAt')}</th><th scope="col">{t.t('ops3.bmc.series.colTemp')}</th><th scope="col">{t.t('ops3.bmc.series.colOut')}</th></tr></thead>
          <tbody>{points.map((p, i) => (
            <tr key={`${p.at}-${i}`} data-kv-point={p.at}>
              <td>{atText(p.at) ?? p.at}</td><td data-kv-point-temp={p.tempC}>{p.tempC}</td>
              <td data-kv-point-out={p.isBreach ? 'yes' : 'no'}>{t.t(p.isBreach ? 'ops3.bmc.series.outYes' : 'ops3.bmc.series.outNo')}</td>
            </tr>))}</tbody>
        </table>
      )}
    </article>
  );
}

/** What a manual reading IS, in the words the code proves (Q13-A: labelled as manual; no photo). Printed with the form and its review. */
export function ManualFacts({ t }: { t: Tr }) {
  return (
    <ul className="kv-facts-list">
      {['ops3.bmc.manual.label', 'ops3.bmc.manual.noBreach', 'ops3.bmc.manual.alertRule', 'ops3.bmc.manual.noPhoto'].map((k) =>
        <li key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</li>)}
    </ul>
  );
}

/** "Log manual reading" (FM:44): one input. A GET to the review step — nothing is recorded until "Record this reading" there. */
export function ManualReadingForm({ t, tile, value }: { t: Tr; tile: DairyBmcTile; value?: string }) {
  return (
    <form method="get" action={BMC} className="kv-card" data-kv-form="manual-reading" data-kv-form-unit={tile.unitId}>
      <h2 className="kv-card__title">{t.t('ops3.bmc.manual.title')}</h2>
      <ManualFacts t={t} />
      <input type="hidden" name="form" value="review" />
      <input type="hidden" name="unit" value={tile.unitId} />
      <label className="kv-field">
        <span>{t.t('ops3.bmc.manual.field')}</span>
        <input name="tempC" inputMode="decimal" autoComplete="off" required maxLength={6} pattern="-?\d{1,3}(\.\d)?" defaultValue={value ?? ''} />
      </label>
      <p className="kv-pager"><button type="submit" className="kv-btn">{t.t('ops3.bmc.manual.check')}</button></p>
    </form>
  );
}

export interface BmcProps {
  t: Tr; state: BmcState; scope: BmcScope; centres: readonly DairyMcc[]; tiles: readonly DairyBmcTile[]; cooler: DairyBmcTile | null; points: Points | null;
  /** PC-56 RTL-1g: the page language (the cooler's centre code is isolated under Arabic only); 'en' when absent. */
  lang?: string;
}
export function BmcView({ t, state, scope, tiles, cooler, points, lang = 'en' }: BmcProps) {
  return (
    <section data-kv-page="bmc">
      <h1>{t.t('ops3.bmc.title')}</h1>
      <BmcChrome t={t} />
      <p className="kv-lead" data-kv-statement="ops3.bmc.readsOnly">{t.t('ops3.bmc.readsOnly')}</p>
      {state !== 'ok' ? <BmcStateView t={t} state={state} /> : (
        <>
          <p className="kv-muted" data-kv-scope={scope}>{t.t(scope === 'custody' ? 'ops3.bmc.scope.custody' : 'ops3.bmc.scope.organisation')}</p>
          {tiles.length === 0 || !cooler ? <p className="kv-muted" data-kv-empty="coolers">{t.t('ops3.bmc.noCooler')}</p> : (
            <>
              {tiles.length > 1 ? (
                <nav aria-label={t.t('ops3.bmc.pick')} data-kv-pick="coolers">
                  <ul>{tiles.map((x) => <li key={x.unitId}>{x.unitId === cooler.unitId
                    ? <span aria-current="true" data-kv-picked={x.unitId}>{t.t('ops3.bmc.cooler', { code: ltrText(x.mccCode, lang), name: x.mccName })}</span>
                    : <Link href={`${BMC}?unit=${x.unitId}`} data-kv-pick-unit={x.unitId}>{t.t('ops3.bmc.cooler', { code: ltrText(x.mccCode, lang), name: x.mccName })}</Link>}</li>)}</ul>
                </nav>
              ) : null}
              <CoolerCard t={t} tile={cooler} lang={lang} />
              <ReadingSeries t={t} points={points} />
              <ManualReadingForm t={t} tile={cooler} />
            </>
          )}
          <p className="kv-statement" data-kv-statement="ops3.bmc.settingsElsewhere">{t.t('ops3.bmc.settingsElsewhere')}</p>
          <p className="kv-refusal" data-kv-refused-act="tanker_dispatch">{t.t('ops3.bmc.dispatchRefused')}</p>
        </>
      )}
      <Ops3Refusals t={t} surface="bmc" />
    </section>
  );
}

/* ═════════════════════════════ the bmc form chain's own content (W3282–W3285) ═════════════════════════════ */
/** W3282: the value the API would refuse, named; the typed value is kept in the form below it. */
export function FormErrorReason({ t, error }: { t: Tr; error: FormError }) {
  return <p className="kv-refusal" role="alert" data-kv-reason={error}>{t.t(`ops3.bmc.formError.${error}`)}</p>;
}
/** W3283: the reading as typed and the cooler's band as the monitor sent it — no verdict is guessed here; the SERVER gives it. */
export function ReadingReview({ t, tile, tempC, action, lang = 'en' }: { t: Tr; tile: DairyBmcTile; tempC: string; action: (fd: FormData) => Promise<void>; lang?: string }) {
  return (
    <form action={action} className="kv-card" data-kv-review={tile.unitId}>
      <dl className="kv-facts">
        <Fact t={t} k="ops3.bmc.review.cooler" kv={{ 'data-kv-review-cooler': tile.unitId }}>{t.t('ops3.bmc.cooler', { code: ltrText(tile.mccCode, lang), name: tile.mccName })}</Fact>
        <Fact t={t} k="ops3.bmc.review.typed" kv={{ 'data-kv-review-temp': tempC }}>{t.t('ops3.bmc.review.typedValue', { temp: tempC })}</Fact>
        <Fact t={t} k="ops3.bmc.band" kv={{ 'data-kv-band': `${tile.band.minC}|${tile.band.maxC}` }}>{t.t('ops3.bmc.bandValue', { min: tile.band.minC, max: tile.band.maxC })}</Fact>
      </dl>
      <ManualFacts t={t} />
      <p className="kv-muted">{t.t('ops3.bmc.review.verdictLater')}</p>
      <input type="hidden" name="unit" value={tile.unitId} />
      <input type="hidden" name="tempC" value={tempC} />
      <p className="kv-pager">
        <button type="submit" className="kv-btn">{t.t('ops3.bmc.review.record')}</button>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${BMC}?unit=${tile.unitId}`} data-kv-link="edit">{t.t('ops3.bmc.review.edit')}</Link>
      </p>
    </form>
  );
}
/** W3284: the SERVER's answer — the reading, its verdict, the band, the time the server recorded it. */
export function ReadingRecorded({ t, reading }: { t: Tr; reading: RecordedReading | null }) {
  if (!reading) return <p className="kv-muted" data-kv-empty="reading">{t.t('ops3.bmc.success.none')}</p>;
  return (
    <dl className="kv-facts" data-kv-recorded={reading.unitId}>
      <Fact t={t} k="ops3.bmc.success.reading" kv={{ 'data-kv-temp': reading.tempC }}>{t.t('ops3.bmc.success.readingValue', { temp: reading.tempC })}</Fact>
      <Fact t={t} k="ops3.bmc.verdict" kv={{ 'data-kv-verdict': reading.verdict }}>{t.t(`ops3.bmc.verdict.${reading.verdict}`)}</Fact>
      <Fact t={t} k="ops3.bmc.band" kv={{ 'data-kv-band': `${reading.band.minC}|${reading.band.maxC}` }}>{t.t('ops3.bmc.bandValue', { min: reading.band.minC, max: reading.band.maxC })}</Fact>
      <Fact t={t} k="ops3.bmc.success.at" kv={{ 'data-kv-recorded-at': reading.recordedAt }}>{atText(reading.recordedAt) ?? ''}</Fact>
    </dl>
  );
}
/** W3285: the named refusal. */
export function ReadingFailure({ t, reason }: { t: Tr; reason: ReadingReason }) {
  return <p className="kv-refusal" role="alert" data-kv-reason={reason}>{t.t(`ops3.bmc.reason.${reason}`)}</p>;
}
