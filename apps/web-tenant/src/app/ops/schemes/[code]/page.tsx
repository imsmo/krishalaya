// apps/web-tenant/src/app/ops/schemes/[code]/page.tsx · W203 · ONE SCHEME'S PIPELINE · PC-56 TENANT-SW-b.
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • tabs with REAL counts (under verification · clarification needed · submitted · draft · approved/disbursed this FY · rejected /
//     appealed). The canon wires three of them to `chain-mutate:scheme` (F-22, a canon defect) — here they are FILTERS, and the page
//     says so;
//   • rows: Waiting (days since the last change) · Applicant (short name + MASKED phone) · Blocker (derived from the state, the
//     clarification note and an open DBT bounce) · Assisted by · Govt ref; a rejection prints its code WITH the translated label
//     and the FIX (seed core/0026) — a rejection is a to-do list, not a verdict;
//   • the application form is MASKED: one field at a time is revealed with a reason (≥ 20 characters), audited by field name
//     (the 1b/9a/13b RevealField);
//   • "Run eligibility sweep" → the mutate chain W2751–W2753 (`./act`): a keyed act, once per scheme per IST day; the job evaluates
//     every member through the per-person evaluator and writes a CALL LIST — it never creates an application (the canon: a human
//     asks first). The latest sweeps and a sweep's call list (`?sweep=<id>`) are shown here.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { SchemePipeline, SchemeSweepView } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import {
  MIN_SCHEME_REVEAL_REASON, PIPELINE_GROUPS, SCHEMES_DESK_HREF, blockerKey, cursorFrom, groupFrom, isSchemeCode, isUuid, rejectionText, schemeHref, sweepActHref, sweepStatusKey, swbState,
} from '../../../../features/swb/console';
import { RevealField } from '../../../people/RevealField';
import { revealSchemeFieldAction } from '../actions';
import { AsOf } from '../../../../components/AsOf';
import { asOfLabels } from '../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.scm.pipeline'), robots: { index: false, follow: false } };
}

export default async function SchemePipelinePage({ params, searchParams }: { params: { code: string }; searchParams: Record<string, string | undefined> }) {
  const code = isSchemeCode(params.code) ? params.code : '';
  await requireSession(code ? schemeHref(code) : SCHEMES_DESK_HREF);
  const t = getTranslator();
  const lang = getLang();
  const n = (v: number) => formatNumber(v, lang);
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }) : t.t('common.dash'));
  const group = groupFrom(searchParams.group);
  const cursor = cursorFrom(searchParams.cursor);
  const sweepId = isUuid(searchParams.sweep) ? searchParams.sweep : null;
  const showAll = searchParams.all === '1';
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('swb.scm.breadcrumb')}><Link href={SCHEMES_DESK_HREF}>{t.t('swb.scm.title')}</Link> / <span aria-current="page">{code || t.t('common.dash')}</span></nav>;
  if (!env.featureSchemes) {
    return <section>{crumbs}<h1>{t.t('swb.scm.pipeline')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('swb.scm.state.flaggedOff.title')}</strong><p>{t.t('swb.scm.state.flaggedOff.body')}</p></div></section>;
  }
  let p: SchemePipeline | null = null; let sweep: SchemeSweepView | null = null; let state: string | null = code ? null : 'notFound';
  if (!state) {
    const [a, b] = await Promise.allSettled([
      tenantClient().schemes.deskPipeline(code, { group, cursor, limit: 50 }),
      sweepId ? tenantClient().schemes.sweep(sweepId, { all: showAll, cursor: cursorFrom(searchParams.sweepCursor), limit: 50 }) : Promise.resolve(null),
    ]);
    if (a.status === 'fulfilled') p = a.value; else { const e = a.reason instanceof SdkError ? a.reason : null; state = swbState(e?.code, e?.status); }
    if (b.status === 'fulfilled') sweep = b.value;
  }
  const revealLabels = (fields: string[]) => ({
    open: t.t('swb.scm.reveal.open'), heading: t.t('swb.scm.reveal.heading'), field: t.t('people.reveal.field'),
    fieldOption: Object.fromEntries(fields.map((f) => [f, f])), reason: t.t('people.reveal.reason'),
    reasonHint: t.t('people.reveal.reasonHint', { min: MIN_SCHEME_REVEAL_REASON }), submit: t.t('people.reveal.submit'), working: t.t('people.reveal.working'),
    hide: t.t('people.reveal.hide'), empty: t.t('people.reveal.empty'), recorded: t.t('swb.scm.reveal.recorded'),
    error: { field: t.t('people.reveal.error.field'), reason: t.t('people.reveal.error.reason'), forbidden: t.t('people.reveal.error.forbidden'), notFound: t.t('people.reveal.error.notFound'), failed: t.t('people.reveal.error.failed') },
  });

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{p ? p.scheme.name : t.t('swb.scm.pipeline')}</h1>
        {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
        <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
        {p && <p className="kv-actions"><Link href={sweepActHref(p.scheme.code)} className="kv-btn kv-btn--primary">{t.t('swb.scm.act.sweep')}</Link></p>}
      </div>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`swb.scm.state.${state}.title`)}</strong><p>{t.t(`swb.scm.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={schemeHref(code, group, cursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.retry')}</Link></p>}
        </div>
      )}
      {p && (
        <>
          <p className="kv-field__hint"><code>{p.scheme.code}</code> · {t.t('swb.scm.version', { v: String(p.scheme.version) })} · {t.t(p.scheme.isActive ? 'swb.scm.active' : 'swb.scm.inactive')}</p>
          <nav className="kv-pager" aria-label={t.t('swb.scm.tabs')}>
            {PIPELINE_GROUPS.map((g) => (
              <Link key={g} href={schemeHref(p!.scheme.code, g)} className={`kv-btn--link${g === group ? ' is-active' : ''}`} aria-current={g === group ? 'page' : undefined}>
                {t.t(`swb.scm.group.${g}`)} ({n(p!.counts[g] ?? 0)})
              </Link>
            ))}
          </nav>
          <p className="kv-field__hint">{t.t('swb.scm.refused.tabsAreFilters')}</p>
          {p.items.length === 0 ? <div className="kv-card"><p className="kv-detail__muted">{t.t('swb.scm.pipelineEmpty')}</p></div> : (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('swb.scm.col.waiting')}</th><th scope="col">{t.t('swb.scm.col.applicant')}</th><th scope="col">{t.t('swb.scm.col.blocker')}</th>
                <th scope="col">{t.t('swb.scm.col.assisted')}</th><th scope="col">{t.t('swb.scm.col.ref')}</th><th scope="col">{t.t('swb.scm.col.form')}</th></tr></thead>
              <tbody>{p.items.map((a) => {
                const rej = a.rejection ? rejectionText(a.rejection, lang) : null;
                return (
                  <tr key={a.id}>
                    <td>{a.waitingDays === null ? t.t('common.dash') : t.t('swb.scm.days', { n: n(a.waitingDays) })}</td>
                    <th scope="row">{a.applicantShortName ?? t.t('swb.workerUnnamed')}<div className="kv-field__hint">{a.applicantPhoneMasked}</div></th>
                    <td>{a.blocker ? t.t(blockerKey(a.blocker.code)) : t.t('swb.scm.blocker.none')}
                      {a.blocker?.note && <div className="kv-field__hint">{a.blocker.note}</div>}
                      {a.rejection && <div className="kv-field__hint"><code>{a.rejection.code}</code> {rej?.label ?? ''}{rej?.fix && <><br /><strong>{t.t('swb.scm.fix')}</strong> {rej.fix}</>}</div>}
                      {!a.rejection && a.blocker?.reasonCode && <div className="kv-field__hint"><code>{a.blocker.reasonCode}</code></div>}</td>
                    <td>{a.selfFiled ? t.t('swb.scm.selfFiled') : (a.assistedBy?.shortName ?? t.t('swb.workerUnnamed'))}</td>
                    <td>{a.govtAppRef ?? t.t('common.dash')}<div className="kv-field__hint">{when(a.submittedAt)}</div></td>
                    <td>{a.formFields.length === 0 ? t.t('swb.scm.formEmpty') : <RevealField userId={a.id} name={a.applicantShortName ?? ''} fields={a.formFields} reveal={revealSchemeFieldAction} minReason={MIN_SCHEME_REVEAL_REASON} labels={revealLabels(a.formFields)} />}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          {p.nextCursor && <p><Link href={schemeHref(p.scheme.code, group, p.nextCursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.nextPage')}</Link></p>}

          <h2>{t.t('swb.scm.sweeps')}</h2>
          <p className="kv-field__hint">{t.t('swb.scm.refused.autoApply')}</p>
          {p.sweeps.length === 0 ? <p className="kv-detail__muted">{t.t('swb.scm.sweepsNone')}</p> : (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('swb.scm.col.runDate')}</th><th scope="col">{t.t('swb.wage.col.status')}</th><th scope="col">{t.t('swb.scm.col.evaluated')}</th>
                <th scope="col">{t.t('swb.scm.col.eligible')}</th><th scope="col">{t.t('swb.scm.col.notApplied')}</th><th scope="col">{t.t('swb.scm.col.callList')}</th></tr></thead>
              <tbody>{p.sweeps.map((s) => (
                <tr key={s.id}><td>{when(`${s.runDate}T00:00:00+05:30`)}</td><td>{t.t(sweepStatusKey(s.status))}{s.failure && <div className="kv-field__hint"><code>{s.failure.slice(0, 80)}</code></div>}</td>
                  <td>{n(s.membersEvaluated)}</td><td>{n(s.eligibleCount)}</td><td>{n(s.eligibleNotApplied)}</td>
                  <td>{s.status === 'done' ? <Link href={`${schemeHref(p!.scheme.code, group)}${group === 'under_verification' ? '?' : '&'}sweep=${s.id}`} className="kv-btn--link">{t.t('swb.scm.openCallList')}</Link> : t.t('common.dash')}</td></tr>
              ))}</tbody>
            </table>
          )}
          {sweep && (
            <div className="kv-card">
              <h3>{t.t(showAll ? 'swb.scm.callList.all' : 'swb.scm.callList.title')}</h3>
              <p className="kv-field__hint">{t.t('swb.scm.callList.rule')}</p>
              <p><Link href={`${schemeHref(p.scheme.code)}?sweep=${sweep.sweep.id}${showAll ? '' : '&all=1'}`} className="kv-btn--link">{t.t(showAll ? 'swb.scm.callList.onlyCalls' : 'swb.scm.callList.showAll')}</Link></p>
              {sweep.items.length === 0 ? <p className="kv-detail__muted">{t.t('swb.scm.callList.empty')}</p> : (
                <table className="kv-table">
                  <thead><tr><th scope="col">{t.t('swb.scm.col.applicant')}</th><th scope="col">{t.t('swb.scm.col.eligible')}</th><th scope="col">{t.t('swb.scm.col.reasons')}</th></tr></thead>
                  <tbody>{sweep.items.map((x) => (
                    <tr key={x.id}><th scope="row">{x.shortName ?? t.t('swb.workerUnnamed')}<div className="kv-field__hint">{x.phoneMasked}</div></th>
                      <td>{t.t(x.eligible ? (x.alreadyApplied ? 'swb.scm.eligibleApplied' : 'swb.scm.eligibleCall') : 'swb.scm.notEligible')}</td>
                      <td>{x.reasons.length ? x.reasons.join(' · ') : t.t('common.dash')}</td></tr>
                  ))}</tbody>
                </table>
              )}
              {sweep.nextCursor && <p><Link href={`${schemeHref(p.scheme.code)}?sweep=${sweep.sweep.id}${showAll ? '&all=1' : ''}&sweepCursor=${encodeURIComponent(sweep.nextCursor)}`} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.nextPage')}</Link></p>}
            </div>
          )}
          <div className="kv-card kv-card--notice"><p className="kv-field__hint">{t.t('swb.scm.refused.campWorklist')}</p><p className="kv-field__hint">{t.t('swb.scm.refused.retry')}</p></div>
        </>
      )}
    </section>
  );
}
