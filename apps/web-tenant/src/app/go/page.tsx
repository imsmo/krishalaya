// apps/web-tenant/src/app/go/page.tsx · W2619–W2625 "Book a setup call (free)" — PC-56 TENANT-SW-d (founder decision: a PLATFORM-STAFFED
// request object). The Krishalaya team calls in the slot the organisation chose — there is NO calendar integration, and the page says
// so. One open request per organisation. The phone the team calls is the requester's own (only its last four digits are shown).
//   • W2619 form-error · W2620 review · W2621 success · W2622 failure — the request's form chain;
//   • W2623 confirm · W2624 success · W2625 failure — the CANCEL act (a reason, audited); "Retry" re-reads this page (refused by name as
//     a mutation, as on every SW chain).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { SetupCallRequest } from '@krishalaya/sdk-js';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator } from '../../lib/i18n';
import { GO_HREF, SETUP_CALL_LANGUAGES, istLabel, setupStatusKey, swdCodeKey, swdPageState } from '../../features/swd/console';
import { parseCodes } from '../../features/swc/console';
import { cancelSetupCallAction, requestSetupCallAction, reviewSetupCallAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swd.go.title'), robots: { index: false, follow: false } };
}
const PROBLEMS = ['missing', 'not_future', 'too_far', 'not_after_start', 'too_long'] as const;

export default async function GoPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(GO_HREF);
  const t = getTranslator();
  const step = searchParams.step ?? 'form';
  const act = searchParams.act === 'cancel' ? 'cancel' : null;
  let items: SetupCallRequest[] = []; let nextCursor: string | null = null; let state: string | null = null;
  try { const r = await tenantClient().setupCalls.list(searchParams.cursor); items = r.items; nextCursor = r.nextCursor; }
  catch (e) { const err = e instanceof SdkError ? e : null; state = swdPageState(err?.code, err?.status); }
  const open = items.find((x) => x.status === 'requested' || x.status === 'scheduled') ?? null;
  const v = { date: searchParams.date ?? '', from: searchParams.from ?? '', to: searchParams.to ?? '', languageCode: searchParams.languageCode ?? 'hi', notes: searchParams.notes ?? '' };
  const problem = (PROBLEMS as readonly string[]).includes(searchParams.problem ?? '') ? searchParams.problem : null;

  const form = (
    <form action={reviewSetupCallAction} className="kv-form kv-form__card">
      <label className="kv-field" htmlFor="go-date"><span>{t.t('swd.go.field.date')}</span><input id="go-date" name="date" type="date" className="kv-input" defaultValue={v.date} required /></label>
      <label className="kv-field" htmlFor="go-from"><span>{t.t('swd.go.field.from')}</span><input id="go-from" name="from" type="time" className="kv-input" defaultValue={v.from} required /></label>
      <label className="kv-field" htmlFor="go-to"><span>{t.t('swd.go.field.to')}</span><input id="go-to" name="to" type="time" className="kv-input" defaultValue={v.to} required /></label>
      <p className="kv-field__hint">{t.t('swd.go.ist')}</p>
      <label className="kv-field" htmlFor="go-lang"><span>{t.t('swd.go.field.language')}</span>
        <select id="go-lang" name="languageCode" className="kv-select" defaultValue={v.languageCode}>{SETUP_CALL_LANGUAGES.map((l) => <option key={l} value={l}>{t.t(`swd.go.lang.${l}`)}</option>)}</select></label>
      <label className="kv-field" htmlFor="go-notes"><span>{t.t('swd.go.field.notes')}</span><textarea id="go-notes" name="notes" className="kv-textarea" rows={2} maxLength={500} defaultValue={v.notes} /></label>
      <p className="kv-field__hint">{t.t('swd.go.phoneNote')}</p>
      <button type="submit" className="kv-btn kv-btn--primary">{t.t('swd.go.review')}</button>
    </form>
  );

  return (
    <section>
      <nav className="kv-field__hint"><Link href="/get-started" className="kv-btn--link">{t.t('swd.go.breadcrumb')}</Link> › {t.t('swd.go.title')}</nav>
      <h1>{t.t('swd.go.title')}</h1>
      <p className="kv-field__hint">{t.t('swd.go.lede')}</p>
      <p className="kv-card kv-card--notice">{t.t('swd.go.noCalendar')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swd.state.${state}.title`)}</strong><p>{t.t(`swd.state.${state}.body`)}</p>
        {state === 'error' && <p><Link href={GO_HREF} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swd.refused.retry')}</span></p>}</div>}

      {/* ── W2623 · cancel (confirm → success / failure) ── */}
      {!state && act === 'cancel' && (
        <div className="kv-card">
          <h2>{t.t('swd.go.cancel.title')}</h2>
          <p className="kv-field__hint">{t.t(`mutate.step.${['confirm', 'success', 'failure'].includes(step) ? step : 'confirm'}`)}</p>
          {step === 'success' && <p className="kv-success" role="status">{t.t('swd.go.cancel.done')} <Link href={GO_HREF} className="kv-btn--link">{t.t('swd.chain.back')}</Link></p>}
          {step === 'failure' && (
            <div className="kv-error" role="alert"><strong>{t.t('swd.chain.failure')}</strong>
              <ul className="kv-list">{(parseCodes(searchParams.error).length ? parseCodes(searchParams.error) : ['unknown']).map((c) => <li key={c}>{t.t(swdCodeKey(c))}</li>)}</ul>
              <p>{t.t('swd.chain.untouched')} <Link href={`${GO_HREF}?act=cancel&id=${encodeURIComponent(searchParams.id ?? '')}&step=confirm`} className="kv-btn--link">{t.t('swd.chain.retry')}</Link> · <Link href={GO_HREF} className="kv-btn--link">{t.t('swd.chain.back')}</Link></p></div>
          )}
          {step === 'confirm' && (open && open.id === searchParams.id ? (
            <form action={cancelSetupCallAction} className="kv-form">
              <input type="hidden" name="id" value={open.id} />
              <p>{t.t('swd.go.cancel.object', { from: istLabel(open.slotStart), to: istLabel(open.slotEnd).slice(11) })}</p>
              <label className="kv-field" htmlFor="go-reason"><span>{t.t('swd.field.reason')}</span><textarea id="go-reason" name="reason" className="kv-textarea" rows={2} minLength={3} maxLength={300} required /></label>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('swd.go.cancel.proceed')}</button>{' '}<Link href={GO_HREF} className="kv-btn--link">{t.t('swd.chain.cancel')}</Link>
            </form>
          ) : <p className="kv-error">{t.t('swd.code.SETUP_CALL_NOT_FOUND')}</p>)}
        </div>
      )}

      {/* ── the open request (one per organisation) ── */}
      {!state && !act && open && (
        <div className="kv-card" role="status">
          <h2>{t.t('swd.go.open.title')}</h2>
          <p><strong>{t.t(setupStatusKey(open.status))}</strong> · {t.t('swd.go.open.slot', { from: istLabel(open.slotStart), to: istLabel(open.slotEnd).slice(11) })} · {t.t(`swd.go.lang.${open.languageCode}`)}</p>
          <p className="kv-field__hint">{t.t('swd.go.open.phone', { phone: open.phoneMasked })} · {open.teamNotified ? t.t('swd.go.open.teamNotified') : t.t('swd.go.open.teamPending')}</p>
          {open.scheduledAt && <p>{t.t('swd.go.open.scheduled', { at: istLabel(open.scheduledAt) })}</p>}
          <p><Link href={`${GO_HREF}?act=cancel&id=${encodeURIComponent(open.id)}&step=confirm`} className="kv-btn kv-btn--secondary">{t.t('swd.go.cancel.title')}</Link></p>
        </div>
      )}

      {/* ── W2619–W2622 · the request form chain ── */}
      {!state && !act && !open && step === 'form' && form}
      {!state && !act && step === 'form-error' && (
        <>
          {/* W2619: every invalid field with its reason; the values are kept; nothing was saved */}
          <div className="kv-error" role="alert"><strong>{t.t('swd.go.formError')}</strong><p>{t.t(`swd.go.problem.${problem ?? 'missing'}`)}</p></div>
          {form}
        </>
      )}
      {!state && !act && step === 'review' && (
        <form action={requestSetupCallAction} className="kv-form kv-form__card">
          {/* W2620: everything entered, read-only, before it is sent */}
          <h2>{t.t('swd.go.reviewTitle')}</h2>
          {Object.entries(v).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}
          <input type="hidden" name="key" value={searchParams.key ?? ''} />
          <dl className="kv-dl">
            <dt>{t.t('swd.go.field.date')}</dt><dd>{v.date}</dd>
            <dt>{t.t('swd.go.field.from')}</dt><dd>{v.from} – {v.to} (IST)</dd>
            <dt>{t.t('swd.go.field.language')}</dt><dd>{t.t(`swd.go.lang.${(SETUP_CALL_LANGUAGES as readonly string[]).includes(v.languageCode) ? v.languageCode : 'en'}`)}</dd>
            {v.notes && <><dt>{t.t('swd.go.field.notes')}</dt><dd>{v.notes}</dd></>}
          </dl>
          <p className="kv-field__hint">{t.t('swd.go.noCalendar')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('swd.go.submit')}</button>{' '}
          <Link href={`${GO_HREF}?${new URLSearchParams({ ...v, step: 'form' }).toString()}`} className="kv-btn--link">{t.t('swd.go.backToEdit')}</Link>
        </form>
      )}
      {!state && !act && step === 'success' && <p className="kv-card kv-success" role="status">{t.t('swd.go.success')}</p>}
      {!state && !act && step === 'failure' && (
        <div className="kv-error" role="alert"><strong>{t.t('swd.chain.failure')}</strong>
          <ul className="kv-list">{(parseCodes(searchParams.error).length ? parseCodes(searchParams.error) : ['unknown']).map((c) => <li key={c}>{t.t(swdCodeKey(c))}</li>)}</ul>
          <p>{t.t('swd.chain.untouched')} <Link href={`${GO_HREF}?${new URLSearchParams({ ...v, step: 'form' }).toString()}`} className="kv-btn--link">{t.t('swd.chain.retry')}</Link></p></div>
      )}

      {/* ── the organisation's requests (µs keyset) ── */}
      {!state && items.length > 0 && (
        <>
          <h2>{t.t('swd.go.history')}</h2>
          <table className="kv-table"><thead><tr><th>{t.t('swd.go.col.slot')}</th><th>{t.t('swd.go.col.status')}</th><th>{t.t('swd.go.col.note')}</th></tr></thead>
            <tbody>{items.map((x) => <tr key={x.id}><td>{istLabel(x.slotStart)}–{istLabel(x.slotEnd).slice(11)}</td><td>{t.t(setupStatusKey(x.status))}</td><td>{x.outcomeNote ?? x.cancelReason ?? '—'}</td></tr>)}</tbody></table>
          {nextCursor && <p><Link href={`${GO_HREF}?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('swd.more')}</Link></p>}
        </>
      )}
    </section>
  );
}
