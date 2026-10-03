// apps/web-tenant/src/app/ops/logistics/cod/act/page.tsx · W243 · the COD MUTATE chain (confirm → success → failure) — PC-56 TENANT-SW-a.
// Acts: open today's cash day; close it (a DIFFERENT person from the opener — the database refuses the opener; every remittance of the day
// still collected / deposited must be carried forward with a reason ≥ 10); collect a shortfall recorded against an order (a deposit
// reference ≥ 3 — the cash goes rider-less straight to clearing, balanced in the ledger). The success screen reads the audit entry back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { CodBoard, CodShortfall } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../../features/mutate/chain';
import { COD_HREF, COD_WORKSHEET_HREF, closeCarries, codeKey, isCodAct, isUuid, isYmd, istDateOf, pageState } from '../../../../../features/swa/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { codActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.cod.actTitle'), robots: { index: false, follow: false } }; }
const AUDIT: Record<string, [string, string]> = {
  openDay: ['cod_cash_day', 'logistics.cod_cash_day_opened'], closeDay: ['cod_cash_day', 'logistics.cod_cash_day_closed'], collectShortfall: ['cod_shortfall', 'logistics.cod_shortfall_collected'],
};
type Remit = { id: string; riderUserId?: string; status?: string; amountMinor?: string; createdAt?: string };

export default async function CodActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${COD_HREF}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const act = isCodAct(searchParams.act) ? searchParams.act : 'openDay';
  const step = mutateStep(searchParams.step);
  const id = isUuid(searchParams.id) ? searchParams.id : '';
  const date = isYmd(searchParams.date) ? searchParams.date : '';
  const depositRef = (searchParams.depositRef ?? '').trim().slice(0, 120);
  const note = (searchParams.note ?? '').trim().slice(0, 500);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z0-9_]{2,60}$/.test(x));
  let board: CodBoard | null = null; let sf: CodShortfall | null = null; let open: Remit[] = []; let state: string | null = null;
  if (step === 'confirm') {
    try {
      board = await tenantClient().shipments.codBoard();
      if (act === 'collectShortfall') {
        if (!id) state = 'notFound';
        else { sf = (await tenantClient().shipments.codShortfalls({ status: 'open', limit: 100 })).items.find((s) => s.id === id) ?? null; if (!sf) state = 'notFound'; }
      }
      if (act === 'closeDay') {
        if (!date) state = 'notFound';
        else for (const status of ['collected', 'deposited']) {
          const rows = (await tenantClient().shipments.codRemittancesPage({ status, limit: 200 })).items as Remit[];
          open.push(...rows.filter((r) => r.createdAt && istDateOf(String(r.createdAt)) === date));
        }
      }
    } catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, false); }
  }
  open = open.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const { carries, missing } = closeCarries(open.map((r) => r.id), searchParams);
  const day = board?.days.find((d) => d.businessDate === (date || board!.today)) ?? null;
  const offered = !!board?.enabled && (act === 'openDay' ? !day : act === 'closeDay' ? day?.status === 'open' : !!sf);
  const ready = act === 'openDay' || (act === 'closeDay' && missing.length === 0 && (note === '' || note.length >= 3)) || (act === 'collectShortfall' && depositRef.length >= 3);
  const carry: Record<string, string> = { act, ...(id ? { id } : {}), ...(date ? { date } : {}) };
  const [entity, action] = AUDIT[act];

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.cod.title')}><Link href={COD_HREF}>{t.t('swa.cod.title')}</Link> / <span aria-current="page">{t.t(`swa.cod.act.${act}`)}</span></nav>
      <h1>{t.t(`swa.cod.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (state ? (
        <div className="kv-error" role="alert"><strong>{t.t(`swa.cod.state.${state}.title`)}</strong><p>{t.t(`swa.cod.state.${state}.body`)}</p></div>
      ) : (
        <>
          <div className="kv-card">
            {act === 'openDay' && <p>{t.t('swa.cod.act.rule.openDay', { date: board?.today ?? '' })}</p>}
            {act === 'closeDay' && <p>{t.t('swa.cod.act.rule.closeDay', { date, n: String(open.length) })}</p>}
            {act === 'collectShortfall' && sf && <p>{t.t('swa.cod.act.rule.collectShortfall', { amount: money(sf.amountMinor), order: sf.orderId.slice(0, 8) })}</p>}
            {sf && <p className="kv-detail__muted">{sf.reason}</p>}
            <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          </div>
          {!offered && <div className="kv-error" role="alert"><p>{t.t(board && !board.enabled ? 'swa.cod.off.body' : `swa.cod.act.notOffered.${act}`)}</p></div>}
          {offered && act !== 'openDay' && (
            <form method="get" action={base} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {act === 'closeDay' && (open.length === 0 ? <p className="kv-field__hint">{t.t('swa.cod.close.allReconciled')}</p> : open.map((r) => (
                <label key={r.id} className="kv-field" htmlFor={`carry-${r.id}`}>
                  <span>{t.t('swa.cod.close.carry', { amount: r.amountMinor ? money(String(r.amountMinor)) : t.t('common.dash'), status: t.t(`swa.cod.remit.${r.status === 'deposited' ? 'deposited' : 'collected'}`), rider: String(r.riderUserId ?? '').slice(0, 8) })}</span>
                  <input id={`carry-${r.id}`} name={`carry_${r.id}`} className="kv-input" minLength={10} maxLength={500} defaultValue={searchParams[`carry_${r.id}`] ?? ''} />
                </label>
              )))}
              {act === 'closeDay' && open.length > 0 && <p className="kv-field__hint">{t.t('swa.cod.close.orReconcile')} <Link href={COD_WORKSHEET_HREF} className="kv-btn--link">{t.t('swa.cod.worksheet')}</Link></p>}
              {act === 'collectShortfall' && (
                <label className="kv-field" htmlFor="sf-ref"><span>{t.t('swa.cod.form.depositRef')}</span>
                  <input id="sf-ref" name="depositRef" className="kv-input" minLength={3} maxLength={120} defaultValue={depositRef} /></label>
              )}
              <label className="kv-field" htmlFor="c-note"><span>{t.t('swa.cod.form.note')}</span>
                <textarea id="c-note" name="note" className="kv-textarea" rows={2} maxLength={500} defaultValue={note} /></label>
              {act === 'closeDay' && missing.length > 0 && Object.keys(searchParams).some((k) => k.startsWith('carry_')) && <p className="kv-field__hint">{t.t('swa.cod.form.err.carry')}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {offered && ready ? (
            <form action={codActAction} className="kv-actions">
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {carries.map((c) => <input key={c.remittanceId} type="hidden" name={`carry_${c.remittanceId}`} value={c.reason} />)}
              <input type="hidden" name="carryIds" value={carries.map((c) => c.remittanceId).join(',')} />
              {depositRef && <input type="hidden" name="depositRef" value={depositRef} />}
              {note && <input type="hidden" name="note" value={note} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
              <Link href={COD_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={COD_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      ))}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`swa.cod.act.done.${act}`)}</p></div>
          {isUuid(searchParams.auditId) && <AuditEntryCard t={t} lang={lang} entityType={entity} entityId={searchParams.auditId} action={action} />}
          <p><Link href={COD_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failed.map((c) => <li key={c}>{t.t(codeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...carry, ...(depositRef ? { depositRef } : {}), ...(note ? { note } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={COD_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
