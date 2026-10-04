// apps/web-tenant/src/app/ops/logistics/slots/propose/page.tsx · W2399 "Propose slots" (form chain: edit → review → success / failure)
// · PC-56 TENANT-SW-e. Up to four weekday × window lines and a reason (≥ 10). The success screen says what happens next — the member is
// told in their language and accepts in the app or through the OTP link; nothing is written to their slots until then; unanswered for 7
// days, the proposal expires.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../lib/session';
import { tenantHasPerm } from '../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { chainStep, chainStepKey } from '../../../../../features/forms/chain';
import { MAX_WINDOWS, SLOTS_HREF, failedCodes, isUuid, proposalCarry, proposalRefusals, readProposalDraft, sweCodeKey, weekdayKey } from '../../../../../features/swe/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { proposeSlotsAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.slots.propose'), robots: { index: false, follow: false } }; }

export default async function ProposeSlotsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${SLOTS_HREF}/propose`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const step = chainStep(searchParams.step);
  const d = readProposalDraft(searchParams);
  const refusals = proposalRefusals(d);
  const err = (f: string) => refusals.filter((r) => r.field === f).map((r) => t.t(`swe.slots.form.err.${r.code}`)).join(' ');
  const carried = proposalCarry(d);
  const proposalId = isUuid(searchParams.proposalId) ? searchParams.proposalId : null;
  if (!tenantHasPerm('logistics.manage')) {
    return <section><h1>{t.t('swe.slots.propose')}</h1><div className="kv-card kv-card--notice" role="alert"><strong>{t.t('swe.state.restricted.title')}</strong><p>{t.t('swe.state.restricted.body')}</p></div></section>;
  }
  const rows = Array.from({ length: MAX_WINDOWS }, (_, i) => d.windows[i] ?? { weekday: '', start: '', end: '' });
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.slots.title')}><Link href={SLOTS_HREF}>{t.t('swe.slots.title')}</Link> / <span aria-current="page">{t.t('swe.slots.propose')}</span></nav>
      <h1>{t.t('swe.slots.propose')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, refusals.length > 0))}</p>
      {(step === 'edit' || step === 'review') && (
        <form method="get" action={base} className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="s-seller"><span>{t.t('swe.slots.col.seller')}</span>
            <input id="s-seller" name="sellerUserId" className="kv-input" maxLength={36} defaultValue={d.sellerUserId} />{step === 'review' && err('sellerUserId') && <span className="kv-error">{err('sellerUserId')}</span>}</label>
          {rows.map((w, i) => (
            <fieldset key={i} className="kv-fieldset"><legend>{t.t('swe.slots.form.window', { n: String(i + 1) })}</legend>
              <select name={`w${i}d`} className="kv-select" defaultValue={w.weekday} aria-label={t.t('swe.slots.form.weekday')}>
                <option value="">{t.t('swe.pick')}</option>{[1, 2, 3, 4, 5, 6, 0].map((n) => <option key={n} value={String(n)}>{t.t(weekdayKey(n))}</option>)}
              </select>{' '}
              <input type="time" name={`w${i}s`} className="kv-input" defaultValue={w.start} aria-label={t.t('swe.slots.form.start')} />{' – '}
              <input type="time" name={`w${i}e`} className="kv-input" defaultValue={w.end} aria-label={t.t('swe.slots.form.end')} />
              {step === 'review' && err(`w${i}`) && <span className="kv-error">{err(`w${i}`)}</span>}
            </fieldset>
          ))}
          {step === 'review' && err('windows') && <p className="kv-error">{err('windows')}</p>}
          <label className="kv-field" htmlFor="s-why"><span>{t.t('swe.reason')}</span>
            <textarea id="s-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={d.reason} />{step === 'review' && err('reason') && <span className="kv-error">{err('reason')}</span>}</label>
          <button type="submit" className="kv-btn">{t.t('swe.review')}</button>
        </form>
      )}
      {step === 'review' && refusals.length === 0 && (
        <div className="kv-card">
          <h2>{t.t('swe.reviewTitle')}</h2>
          <ul className="kv-list">{d.windows.map((w, i) => <li key={i}>{t.t(weekdayKey(Number(w.weekday)))} {w.start}–{w.end}</li>)}</ul>
          <p className="kv-field__hint">{t.t('swe.slots.form.wall')}</p>
          <form action={proposeSlotsAction} className="kv-actions">
            {Object.entries(carried).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swe.slots.form.submit')}</button>{' '}
            <Link href={SLOTS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
          </form>
        </div>
      )}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.slots.form.done')}</p></div>
          {proposalId && <AuditEntryCard t={t} lang={lang} entityType="pickup_slot_proposal" entityId={proposalId} action="logistics.slot_proposal_proposed" />}
          <p><Link href={SLOTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failedCodes(searchParams.error).map((c) => <li key={c}>{t.t(sweCodeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t('form.failure.untouched')}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'review', ...carried }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
        </div>
      )}
    </section>
  );
}
