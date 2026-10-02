// apps/web-tenant/src/app/ops/labour/new/page.tsx · THE POST-JOB FORM CHAIN — W2657 form-error · W2658 review · W2659 success ·
// W2660 failure · PC-56 TENANT-11b.
//
// edit → review → success | failure, ONE page, the values in the URL (features/forms/chain.ts). The pickers carry the API's own
// ids (GET /labour/lookups: work types, the skill tree, the states, the skill levels, the cancel reasons, the fee rule). The
// OFFERED WAGE IS SHOWN AGAINST THE STATUTORY FLOOR (GET /labour/lookups/floor) on the edit step once region + skill level +
// start date are set ("Check the floor") and on the review — a wage below it is refused here AND by the database (CHECK
// wage_offered ≥ min_wage). The declarations are fields. ON BEHALF: the desk picks the employer from the member roster
// (1b, masked) and records the employer's consent (channel + evidence) — the API refuses without it. The review shows the
// ESCROW ESTIMATE the roster confirm will set aside if every seat fills (workers × days × rate + the fee) — a preview with the
// server's arithmetic, labelled as one. THE IDEMPOTENCY KEY IS MINTED ON THE REVIEW PAGE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { LabourLookups, RosterMember } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { auditHref, chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref } from '../../../../features/forms/chain';
import {
  CONSENT_CHANNELS, FORM_KEYS, LABOUR_HREF, NEW_JOB_HREF, SKILL_LEVELS, WAGE_KINDS, carried, codeKey, consoleState, escrowPreview, fieldKey, isUuid, isYmd, jobEntries, jobHref,
  perKey, reviewJob, wageKindKey,
} from '../../../../features/labour/console';
import { postJobAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lab.new.title'), robots: { index: false, follow: false } };
}

export default async function NewJobPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_JOB_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(FORM_KEYS, (k) => searchParams[k]);
  const v = (k: string) => values[k] ?? '';
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const createdId = typeof searchParams.id === 'string' && isUuid(searchParams.id) ? searchParams.id : null;
  const back = `${NEW_JOB_HREF}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;
  const employerQ = typeof searchParams.employerQ === 'string' ? searchParams.employerQ.trim().slice(0, 80) : '';

  if (!env.featureLabour) {
    return <section><h1>{t.t('lab.new.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>;
  }

  let lookups: LabourLookups | null = null; let lookupState: string | null = null;
  if (step === 'edit' || step === 'review') {
    try { lookups = await tenantClient().labour.lookups(); }
    catch (e) { const err = e instanceof SdkError ? e : null; lookupState = consoleState(err?.code, err?.status); }
  }
  if (lookupState === 'flaggedOff') {
    return <section><h1>{t.t('lab.new.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>;
  }
  const e = jobEntries(values);
  // The statutory floor for what is typed (undefined = not enough to look it up yet; null = none configured).
  let floor: string | null | undefined;
  if ((step === 'edit' || step === 'review') && isUuid(e.regionId) && e.skillLevel && isYmd(e.startDate)) {
    try { floor = (await tenantClient().labour.floor({ regionId: e.regionId!, skillLevel: e.skillLevel, wageKind: e.wageKind, onDate: e.startDate! })).minWageMinor; } catch { floor = undefined; }
  }
  // On behalf: the employer picker over the member roster (1b — names and MASKED phones only).
  let employers: RosterMember[] | null = null; let employerState: string | null = null;
  if (step === 'edit' && v('onBehalf') === '1' && employerQ.length >= 2) {
    try { employers = (await tenantClient().members.roster({ q: employerQ, limit: 10 })).items; }
    catch (err) { const se = err instanceof SdkError ? err : null; employerState = consoleState(se?.code, se?.status); }
  }
  const refusals = step === 'review' ? reviewJob(e, floor) : [];
  const preview = step === 'review' && e.wageOfferedMinor && e.wageOfferedMinor !== 'invalid' && e.startDate && e.endDate && e.workersNeeded
    ? escrowPreview({ workers: e.workersNeeded, startDate: e.startDate, endDate: e.endDate, dailyHours: e.dailyHours, wageKind: e.wageKind, rateMinor: e.wageOfferedMinor, feeMinor: lookups?.feeRule?.amountMinor ?? null }) : null;
  const ready = step === 'review' && refusals.length === 0;
  const skillName = (id?: string) => lookups?.skills.find((s) => s.id === id)?.name ?? id ?? null;
  const typeName = (code?: string) => lookups?.workTypes.find((w) => w.code === code)?.name ?? code ?? null;
  const regionName = (id?: string) => lookups?.regions.find((r) => r.id === id)?.name ?? id ?? null;
  const yes = (b: boolean) => t.t(b ? 'lab.yes' : 'lab.no');
  const floorLine = floor === undefined ? null : floor === null ? t.t('lab.form.floorNone')
    : t.t('lab.form.floorIs', { floor: t.t(perKey(e.wageKind), { amount: money(floor) }), offered: e.wageOfferedMinor && e.wageOfferedMinor !== 'invalid' ? t.t(perKey(e.wageKind), { amount: money(e.wageOfferedMinor) }) : t.t('form.nothingStored') });

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}><span>{t.t('lab.breadcrumb.operations')}</span> / <Link href={LABOUR_HREF}>{t.t('lab.breadcrumb.labour')}</Link> / <span aria-current="page">{t.t('lab.new.title')}</span></nav>
      <h1>{t.t('lab.new.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && refusals.length > 0))} · {t.t('lab.chain.labour')}</p>
      {lookupState && <div className="kv-error" role="alert"><p>{t.t(`lab.state.${lookupState}.body`)}</p></div>}

      {step === 'edit' && lookups && (
        <form action={NEW_JOB_HREF} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="j-type"><span>{t.t(fieldKey('demandTypeCode'))}</span>
            <select id="j-type" name="demandTypeCode" className="kv-select" defaultValue={v('demandTypeCode')} required>
              <option value="">{t.t('lab.form.choose')}</option>
              {lookups.workTypes.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
            </select></label>
          <label className="kv-field" htmlFor="j-skill"><span>{t.t(fieldKey('taskSkillId'))}</span>
            <select id="j-skill" name="taskSkillId" className="kv-select" defaultValue={v('taskSkillId')} required>
              <option value="">{t.t('lab.form.choose')}</option>
              {lookups.skills.map((s) => <option key={s.id} value={s.id}>{s.name}{s.hazardous ? ` · ${t.t('lab.form.hazardous')}` : ''}</option>)}
            </select></label>
          <label className="kv-field" htmlFor="j-village"><span>{t.t(fieldKey('villageLabel'))}</span>
            <input id="j-village" name="villageLabel" className="kv-input" maxLength={120} defaultValue={v('villageLabel')} /></label>
          <label className="kv-field" htmlFor="j-region"><span>{t.t(fieldKey('regionId'))}</span>
            <select id="j-region" name="regionId" className="kv-select" defaultValue={v('regionId')} required>
              <option value="">{t.t('lab.form.choose')}</option>
              {lookups.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
          <label className="kv-field" htmlFor="j-level"><span>{t.t(fieldKey('skillLevel'))}</span>
            <select id="j-level" name="skillLevel" className="kv-select" defaultValue={v('skillLevel') || 'unskilled'}>
              {SKILL_LEVELS.map((s) => <option key={s} value={s}>{t.t(`lab.level.${s}`)}</option>)}
            </select></label>
          <label className="kv-field" htmlFor="j-workers"><span>{t.t(fieldKey('workersNeeded'))}</span>
            <input id="j-workers" name="workersNeeded" className="kv-input" inputMode="numeric" maxLength={3} defaultValue={v('workersNeeded')} required /></label>
          <label className="kv-field" htmlFor="j-start"><span>{t.t(fieldKey('startDate'))}</span>
            <input id="j-start" name="startDate" type="date" className="kv-input" defaultValue={v('startDate')} required /></label>
          <label className="kv-field" htmlFor="j-end"><span>{t.t(fieldKey('endDate'))}</span>
            <input id="j-end" name="endDate" type="date" className="kv-input" defaultValue={v('endDate')} /></label>
          <label className="kv-field" htmlFor="j-time"><span>{t.t(fieldKey('startTime'))}</span>
            <input id="j-time" name="startTime" type="time" className="kv-input" defaultValue={v('startTime')} /></label>
          <label className="kv-field" htmlFor="j-hours"><span>{t.t(fieldKey('dailyHours'))}</span>
            <input id="j-hours" name="dailyHours" className="kv-input" inputMode="decimal" maxLength={5} defaultValue={v('dailyHours') || '8'} />
            <span className="kv-field__hint">{t.t('lab.form.otHint')}</span></label>
          <label className="kv-field" htmlFor="j-kind"><span>{t.t(fieldKey('wageKind'))}</span>
            <select id="j-kind" name="wageKind" className="kv-select" defaultValue={v('wageKind') || 'per_day'}>
              {WAGE_KINDS.map((k) => <option key={k} value={k}>{t.t(wageKindKey(k))}</option>)}
            </select></label>
          <label className="kv-field" htmlFor="j-wage"><span>{t.t(fieldKey('wage'))}</span>
            <input id="j-wage" name="wage" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('wage')} required />
            <span className="kv-field__hint">{floorLine ?? t.t('lab.form.floorHint')}</span></label>
          <button type="submit" formAction={NEW_JOB_HREF} name="step" value="edit" className="kv-btn--link">{t.t('lab.form.checkFloor')}</button>
          <fieldset className="kv-fieldset">
            <legend>{t.t('lab.form.declarations')}</legend>
            {(['womenOnly', 'transportProvided', 'mealsProvided', 'toiletConfirmed', 'drinkingWater', 'womanSupervisor'] as const).map((k) => (
              <label key={k} className="kv-field" htmlFor={`j-${k}`}><input id={`j-${k}`} name={k} type="checkbox" defaultChecked={v(k) === 'on'} /> <span>{t.t(fieldKey(k))}</span></label>
            ))}
            <label className="kv-field" htmlFor="j-pp"><span>{t.t(fieldKey('transportPickupPoint'))}</span>
              <input id="j-pp" name="transportPickupPoint" className="kv-input" maxLength={150} defaultValue={v('transportPickupPoint')} /></label>
            <label className="kv-field" htmlFor="j-pt"><span>{t.t(fieldKey('transportPickupTime'))}</span>
              <input id="j-pt" name="transportPickupTime" type="time" className="kv-input" defaultValue={v('transportPickupTime')} /></label>
            <p className="kv-field__hint">{t.t('lab.form.declarationsHint')}</p>
          </fieldset>
          <label className="kv-field" htmlFor="j-lat"><span>{t.t(fieldKey('farmLat'))}</span>
            <input id="j-lat" name="farmLat" className="kv-input" inputMode="decimal" maxLength={12} defaultValue={v('farmLat')} required /></label>
          <label className="kv-field" htmlFor="j-lng"><span>{t.t(fieldKey('farmLng'))}</span>
            <input id="j-lng" name="farmLng" className="kv-input" inputMode="decimal" maxLength={12} defaultValue={v('farmLng')} required />
            <span className="kv-field__hint">{t.t('lab.form.fenceHint')}</span></label>
          <label className="kv-field" htmlFor="j-rb"><span>{t.t(fieldKey('respondByHours'))}</span>
            <input id="j-rb" name="respondByHours" className="kv-input" inputMode="numeric" maxLength={3} defaultValue={v('respondByHours')} />
            <span className="kv-field__hint">{t.t('lab.form.respondByHint')}</span></label>
          <label className="kv-field" htmlFor="j-notes"><span>{t.t(fieldKey('notes'))}</span>
            <textarea id="j-notes" name="notes" className="kv-textarea" rows={2} maxLength={300} defaultValue={v('notes')} /></label>
          <fieldset className="kv-fieldset">
            <legend>{t.t('lab.form.onBehalf')}</legend>
            <label className="kv-field" htmlFor="j-ob"><input id="j-ob" name="onBehalf" type="checkbox" value="1" defaultChecked={v('onBehalf') === '1'} /> <span>{t.t('lab.form.onBehalfCheck')}</span></label>
            <label className="kv-field" htmlFor="j-eq"><span>{t.t('lab.form.employerSearch')}</span>
              <input id="j-eq" name="employerQ" type="search" className="kv-input" maxLength={80} defaultValue={employerQ} /></label>
            <button type="submit" formAction={NEW_JOB_HREF} name="step" value="edit" className="kv-btn--link">{t.t('lab.form.employerFind')}</button>
            {employerState && <p className="kv-field__hint">{t.t(employerState === 'restricted' ? 'lab.form.employerRestricted' : 'lab.form.employerError')}</p>}
            {employers && employers.length === 0 && <p className="kv-field__hint">{t.t('lab.form.employerNone')}</p>}
            {employers && employers.length > 0 && (
              <ul className="kv-list">{employers.map((m) => (
                <li key={m.userId}><label htmlFor={`j-emp-${m.userId}`}><input id={`j-emp-${m.userId}`} type="radio" name="employerUserId" value={m.userId} defaultChecked={v('employerUserId') === m.userId} />{' '}
                  {t.t('lab.form.employerRow', { name: m.fullName ?? t.t('lab.employerUnnamed'), phone: m.phoneMasked, village: m.villageName ?? t.t('lab.villageUnknown') })}</label></li>
              ))}</ul>
            )}
            {v('employerUserId') && !employers && <input type="hidden" name="employerUserId" value={v('employerUserId')} />}
            <label className="kv-field" htmlFor="j-cc"><span>{t.t(fieldKey('consentChannel'))}</span>
              <select id="j-cc" name="consentChannel" className="kv-select" defaultValue={v('consentChannel')}>
                <option value="">{t.t('lab.form.choose')}</option>
                {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`lab.consent.${c}`)}</option>)}
              </select></label>
            <label className="kv-field" htmlFor="j-cm"><span>{t.t(fieldKey('consentMediaId'))}</span>
              <input id="j-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={v('consentMediaId')} />
              <span className="kv-field__hint">{t.t('lab.consent.evidenceHint')}</span></label>
            <label className="kv-field" htmlFor="j-cn"><span>{t.t('lab.consent.note')}</span>
              <input id="j-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={v('consentNote')} /></label>
            <p className="kv-field__hint">{t.t('lab.form.onBehalfHint')}</p>
          </fieldset>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {refusals.filter((r) => r.field === null).map((r) => <div key={r.code} className="kv-error" role="alert"><p>{t.t(codeKey(r.code))}</p></div>)}
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
            <tbody>
              {([
                ['demandTypeCode', typeName(e.demandTypeCode)],
                ['taskSkillId', skillName(e.taskSkillId)],
                ['villageLabel', e.villageLabel ?? null],
                ['regionId', regionName(e.regionId)],
                ['skillLevel', e.skillLevel ? t.t(`lab.level.${e.skillLevel}`) : null],
                ['workersNeeded', e.workersNeeded !== undefined ? String(e.workersNeeded) : null],
                ['startDate', e.startDate ?? null], ['endDate', e.endDate ?? null], ['startTime', e.startTime ?? null],
                ['dailyHours', e.dailyHours], ['wageKind', t.t(wageKindKey(e.wageKind))],
                ['wage', e.wageOfferedMinor && e.wageOfferedMinor !== 'invalid' ? t.t(perKey(e.wageKind), { amount: money(e.wageOfferedMinor) }) : null],
                ['womenOnly', yes(e.womenOnly)], ['transportProvided', yes(e.transportProvided)], ['transportPickupPoint', e.transportPickupPoint ?? null],
                ['transportPickupTime', e.transportPickupTime ?? null], ['mealsProvided', yes(e.mealsProvided)], ['toiletConfirmed', yes(e.toiletConfirmed)],
                ['drinkingWater', yes(e.drinkingWater)], ['womanSupervisor', yes(e.womanSupervisor)],
                ['farmLat', e.farmLat !== undefined && e.farmLng !== undefined ? `${e.farmLat}, ${e.farmLng}` : null],
                ['respondByHours', e.respondByHours !== undefined ? String(e.respondByHours) : null], ['notes', e.notes ?? null],
                ...(e.onBehalf ? [['employerUserId', e.employerUserId ?? null], ['consentChannel', e.consentChannel ? t.t(`lab.consent.${e.consentChannel}`) : null], ['consentMediaId', e.consentMediaId ?? null]] : []),
              ] as Array<[string, string | null]>).map(([name, shown]) => (
                <tr key={name}>
                  <th scope="row">{t.t(fieldKey(name))}</th>
                  <td>{shown ?? <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                    {name === 'wage' && floorLine && <p className="kv-field__hint">{floorLine}</p>}
                    {refusals.filter((r) => r.field === name).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('form.diff.notApplicable')}</p>
          {preview && (
            <div className="kv-card">
              <h2>{t.t('lab.review.escrowTitle')}</h2>
              <p>{t.t('lab.cost.wages', { workers: String(e.workersNeeded), days: String(preview.days), rate: t.t(perKey(e.wageKind), { amount: money(e.wageOfferedMinor) }), amount: money(preview.wagesMinor) })}</p>
              <p>{t.t('lab.cost.fee', { amount: money(preview.feeMinor) })} <span className="kv-field__hint">{lookups?.feeRule?.capMinor ? t.t('lab.cost.capSet', { cap: money(lookups.feeRule.capMinor) }) : t.t('lab.cost.capNotSet')}</span></p>
              <p><strong>{t.t('lab.cost.total', { amount: money(preview.totalMinor) })}</strong></p>
              <p className="kv-field__hint">{t.t('lab.review.escrowPreviewNote')}</p>
            </div>
          )}
          {ready ? (
            <form action={postJobAction} className="kv-actions">
              {Object.entries(values).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.submit')}</button>{' '}
              <Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : (
            <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}<Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('lab.new.done')}</p>
          <p className="kv-field__hint">{t.t('lab.new.doneNext')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p>{createdId && <><Link href={auditHref('labour_booking', createdId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}
            <Link href={jobHref(createdId)} className="kv-btn--link">{t.t('lab.row.open')}</Link>{' · '}</>}
            <Link href={LABOUR_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(NEW_JOB_HREF, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={LABOUR_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
