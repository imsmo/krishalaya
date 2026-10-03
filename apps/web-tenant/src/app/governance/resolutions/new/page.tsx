// apps/web-tenant/src/app/governance/resolutions/new/page.tsx · THE RESOLUTIONS FORM CHAIN — W2741 form-error → W2742 review →
// W2743 success → W2744 failure, for the canon's acts *Draft resolution · Draft resolution (board)* · PC-56 TENANT-9b.
//
// 6d-4's shape: ONE page, four states, values in the URL, and a review THE API COMPUTES (`POST governance/resolutions/preview`):
// the ballot the members will see for this type (0182's declared choices — none for a board election, refused by name), the
// quorum and pass rule from the cooperative's own bylaws (fixed when voting opens), the window typed as the cooperative's
// CIVIL time and turned into instants by the database in its zone, the formula the canon draws (per-share rate · patronage %
// with a cap over the DECLARED fiscal year · a pot) with money at the currency's own scale, whether closing needs a second
// person, and — on an edit (`?id=`) — the diff against the draft as it stands. THE KEY IS MINTED ON THE REVIEW PAGE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ResolutionCatalogue, ResolutionDraftReview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { auditHref, carryValues, chainHref, chainStep, chainStepKey, failureKey, isFormError, nothingStoredKey, normalisedKey, repeatedFailuresGapKey, valuesLostKey } from '../../../../features/forms/chain';
import {
  DRAFT_FIELDS, FORMULA_MODES, MAJORITIES, MAX_CARRIED_RESOLUTION, MODE_FIELDS, NEW_RESOLUTION_HREF, RESOLUTIONS_HREF, RESOLUTION_TYPES,
  choiceKey, draftValues, fieldKey, formulaModeKey, govState, majorityKey, prefillFrom, refusalKey, ruleVars, typeKey,
} from '../../../../features/governance/resolutions';
import { submitResolutionAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('res.form.title'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResolutionFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_RESOLUTION_HREF);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const id = typeof searchParams.id === 'string' && UUID.test(searchParams.id) ? searchParams.id : null;
  const failed = typeof searchParams.error === 'string' ? searchParams.error.split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)) : [];
  const savedId = typeof searchParams.saved === 'string' && UUID.test(searchParams.saved) ? searchParams.saved : null;
  const m = tenantClient().memberships;

  let cat: ResolutionCatalogue | null = null; let state: string | null = null;
  let values = draftValues(searchParams);
  // PC-56 TENANT-12 (F-14): the receipt a proposal came from (a DONE twin run), shown read-only when present — never editable here.
  let sourceRef: { kind: 'twin_run'; id: string } | null = null;
  if (id) { try { sourceRef = (await m.resolutionDraft(id)).sourceRef ?? null; } catch { sourceRef = null; } }
  if (step === 'edit') {
    try { cat = await m.resolutionCatalogue(); } catch (e) { const err = e instanceof SdkError ? e : null; state = govState(err?.code, err?.status, true); }
    // An edit with nothing carried yet starts from the draft as it stands — civil times in the cooperative's zone.
    if (id && !values.title) {
      try { values = prefillFrom(await m.resolutionDraft(id), cat?.currency ?? null); }
      catch (e) { const err = e instanceof SdkError ? e : null; state = govState(err?.code, err?.status); }
    }
  }
  let review: ResolutionDraftReview | null = null; let reviewError: string | null = null;
  if (step === 'review') {
    const input = Object.fromEntries(DRAFT_FIELDS.map((f) => [f, values[f]]).filter(([, v]) => (v as string).trim().length > 0));
    try { review = await m.previewResolution(input, id ?? undefined); }
    catch (e) { const err = e instanceof SdkError ? e : null; reviewError = err?.code || 'review'; if (err?.status === 403) state = 'restricted'; }
  }
  const carry = (s: string) => carryValues(s, { ...values, ...(id ? { id } : {}) }, MAX_CARRIED_RESOLUTION);
  const reviewQuery = carry('review');
  const type = values.resolutionType;
  const dividendClass = cat?.types.find((x) => x.code === type)?.dividendClass === true;
  const used = MODE_FIELDS[values.formulaMode] ?? [];

  return (
    <section>
      <h1>{t.t(id ? 'res.form.editTitle' : 'res.form.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review as never)))} · {t.t('res.form.module')}</p>
      <p className="kv-field__hint"><Link href={RESOLUTIONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`res.state.${state}.title`)}</strong><p>{t.t(`res.state.${state}.body`)}</p></div>}
      {sourceRef && <p className="kv-card kv-card--notice" role="note">{t.t('res.form.sourceRef', { id: sourceRef.id })}</p>}

      {step === 'edit' && !state && cat && (
        <>
          {/* Choosing the type redraws the form: a dividend-class type carries a formula, a motion carries none. */}
          <form action={NEW_RESOLUTION_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="edit" />
            {id && <input type="hidden" name="id" value={id} />}
            {DRAFT_FIELDS.filter((f) => f !== 'resolutionType' && f !== 'formulaMode').map((f) => <input key={f} type="hidden" name={f} value={values[f]} />)}
            <label className="kv-field" htmlFor="r-type0"><span>{t.t(fieldKey('resolutionType'))}</span>
              <select id="r-type0" name="resolutionType" className="kv-select" defaultValue={type}>
                <option value="">{t.t('res.form.chooseType')}</option>
                {RESOLUTION_TYPES.map((x) => <option key={x} value={x}>{t.t(typeKey(x))}{x === 'board_election' ? ` — ${t.t('res.form.notModelled')}` : ''}</option>)}
              </select></label>
            {dividendClass && (
              <label className="kv-field" htmlFor="r-mode0"><span>{t.t(fieldKey('formulaMode'))}</span>
                <select id="r-mode0" name="formulaMode" className="kv-select" defaultValue={values.formulaMode}>
                  <option value="">{t.t('res.form.chooseMode')}</option>
                  {FORMULA_MODES.map((x) => <option key={x} value={x}>{t.t(formulaModeKey(x))}</option>)}
                </select></label>
            )}
            <button type="submit" className="kv-btn--link">{t.t('res.form.redraw')}</button>
          </form>
          {type === 'board_election' && <p className="kv-error" role="alert">{t.t('res.refused.boardElection')}</p>}

          <form action={NEW_RESOLUTION_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="review" />
            {id && <input type="hidden" name="id" value={id} />}
            <input type="hidden" name="resolutionType" value={type} />
            {dividendClass && <input type="hidden" name="formulaMode" value={values.formulaMode} />}
            <label className="kv-field" htmlFor="r-title"><span>{t.t(fieldKey('title'))}</span>
              <input id="r-title" name="title" className="kv-input" defaultValue={values.title} maxLength={250} required /></label>
            <label className="kv-field" htmlFor="r-body"><span>{t.t(fieldKey('body'))}</span>
              <textarea id="r-body" name="body" className="kv-textarea" rows={5} defaultValue={values.body} maxLength={10000} /></label>
            <p className="kv-field__hint">{t.t('res.refused.perLanguageText')}</p>
            <label className="kv-field" htmlFor="r-majority"><span>{t.t(fieldKey('majority'))}</span>
              <select id="r-majority" name="majority" className="kv-select" defaultValue={values.majority || 'ordinary'}>
                {MAJORITIES.map((x) => <option key={x} value={x}>{t.t(majorityKey(x))}</option>)}
              </select></label>
            <p className="kv-field__hint">{t.t('res.form.majorityHint', { special: `${cat.rules.special.num}/${cat.rules.special.den}` })}</p>
            <label className="kv-field" htmlFor="r-opens"><span>{t.t(fieldKey('votingOpens'))}</span>
              <input id="r-opens" name="votingOpens" type="datetime-local" className="kv-input" defaultValue={values.votingOpens} /></label>
            <label className="kv-field" htmlFor="r-closes"><span>{t.t(fieldKey('votingCloses'))}</span>
              <input id="r-closes" name="votingCloses" type="datetime-local" className="kv-input" defaultValue={values.votingCloses} /></label>
            <p className="kv-field__hint">{t.t('res.form.windowHint', { zone: cat.zone })}</p>
            {dividendClass && used.includes('potAmount') && (
              <label className="kv-field" htmlFor="r-pot"><span>{t.t(fieldKey('potAmount'))} ({cat.currency?.code ?? '—'})</span>
                <input id="r-pot" name="potAmount" className="kv-input" inputMode="decimal" defaultValue={values.potAmount} /></label>
            )}
            {dividendClass && used.includes('ratePct') && (
              <label className="kv-field" htmlFor="r-rate"><span>{t.t(fieldKey('ratePct'))}</span>
                <input id="r-rate" name="ratePct" className="kv-input" inputMode="decimal" defaultValue={values.ratePct} /></label>
            )}
            {dividendClass && used.includes('capAmount') && (
              <label className="kv-field" htmlFor="r-cap"><span>{t.t(fieldKey('capAmount'))} ({cat.currency?.code ?? '—'})</span>
                <input id="r-cap" name="capAmount" className="kv-input" inputMode="decimal" defaultValue={values.capAmount} /></label>
            )}
            {dividendClass && used.includes('fiscalYear') && (
              <>
                <label className="kv-field" htmlFor="r-fy"><span>{t.t(fieldKey('fiscalYear'))}</span>
                  <input id="r-fy" name="fiscalYear" className="kv-input" inputMode="numeric" pattern="\d{4}" maxLength={4} defaultValue={values.fiscalYear} /></label>
                <p className="kv-field__hint">{cat.fiscalYearStartMonth === null ? t.t('res.form.fyNotDeclared') : t.t('res.form.fyHint', { month: String(cat.fiscalYearStartMonth) })}</p>
              </>
            )}
            {dividendClass && <p className="kv-field__hint">{t.t(`res.form.modeHint.${(FORMULA_MODES as readonly string[]).includes(values.formulaMode) ? values.formulaMode : 'none'}`)}</p>}
            <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
          </form>
        </>
      )}

      {step === 'review' && (
        <>
          {!reviewQuery.preserved && <p className="kv-notice" role="note">{t.t(valuesLostKey())}</p>}
          {reviewError && !review && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} <code>{reviewError}</code></p></div>}
          {review && (
            <>
              {review.refusals.filter((r) => r.field === null).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(r.code))}</p></div>)}
              <table className="kv-table">
                <caption className="kv-sr-only">{t.t('form.step.review')}</caption>
                <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.entered')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
                <tbody>{review.fields.map((f) => (
                  <tr key={f.name}>
                    <th scope="row">{t.t(fieldKey(f.name))}</th>
                    <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                    <td>
                      {f.stored === null ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>
                        : <strong>{f.name === 'resolutionType' ? t.t(typeKey(f.stored)) : f.name === 'majority' ? t.t(majorityKey(f.stored)) : f.name === 'formulaMode' ? t.t(formulaModeKey(f.stored)) : f.stored}</strong>}
                      {f.normalised && f.stored !== null && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                      {review.refusals.filter((r) => r.field === f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(r.code))}</div>)}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="kv-card">
                <h2>{t.t('res.form.what')}</h2>
                <dl className="kv-facts">
                  <dt>{t.t('res.form.ballot')}</dt>
                  <dd>{review.choices.length ? review.choices.map((c) => t.t(choiceKey(c))).join(' · ') : t.t('res.refused.boardElection')}</dd>
                  <dt>{t.t('res.form.rule')}</dt>
                  <dd>{review.rule ? <>{t.t('res.form.quorum', { q: `${Math.floor(review.rule.quorumBp / 100)}%` })} · {(() => { const r = ruleVars(review.rule); return r ? t.t(r.key, r.vars) : ''; })()} <span className="kv-field__hint">· {t.t('res.form.ruleFixedAtOpen')}</span></> : t.t('common.dash')}</dd>
                  <dt>{t.t('res.form.window')}</dt>
                  <dd>{review.window.closesAt ? t.t('res.form.windowIs', { opens: review.window.opensCivil ?? t.t('res.form.onOpen'), closes: review.window.closesCivil ?? '', zone: review.window.zone }) : t.t('res.form.noWindow', { zone: review.window.zone })}</dd>
                  <dt>{t.t('res.form.closing')}</dt>
                  <dd>{t.t(review.secondPersonToClose ? 'res.form.secondPerson' : 'res.form.samePersonOk')}</dd>
                  {review.formula && <><dt>{t.t('res.form.formula')}</dt>
                    <dd>{t.t(formulaModeKey(review.formula.mode))}{review.formula.fiscalYearFrom ? ` · ${t.t('res.form.fyWindow', { from: review.formula.fiscalYearFrom, to: review.formula.fiscalYearToExclusive ?? '' })}` : ''}<span className="kv-field__hint"> · {t.t('res.form.paysThrough')}</span></dd></>}
                </dl>
              </div>
              <p className="kv-field__hint">{t.t(review.diff === null ? 'form.diff.notApplicable' : 'form.diff.heading')}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.before')}</th><th scope="col">{t.t('form.col.after')}</th></tr></thead>
                  <tbody>{review.diff.map((d) => <tr key={d.field}><th scope="row">{t.t(fieldKey(d.field))}</th><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody>
                </table>
              )}
              {review.ready && reviewQuery.preserved ? (
                <form action={submitResolutionAction}>
                  {DRAFT_FIELDS.map((f) => <input type="hidden" name={f} value={values[f]} key={f} />)}
                  {id && <input type="hidden" name="id" value={id} />}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t(id ? 'res.form.saveEdit' : 'res.form.submit')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(NEW_RESOLUTION_HREF, 'edit', { ...values, ...(id ? { id } : {}) }, MAX_CARRIED_RESOLUTION)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('res.form.done')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {savedId && <p><Link href={`${RESOLUTIONS_HREF}?status=draft`} className="kv-btn kv-btn--primary">{t.t('res.form.toList')}</Link>{' · '}<Link href={auditHref('coop_resolution', savedId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          <p><Link href={RESOLUTIONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(refusalKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={chainHref(NEW_RESOLUTION_HREF, 'review', { ...values, ...(id ? { id } : {}) }, MAX_CARRIED_RESOLUTION)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={RESOLUTIONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
