// apps/web-tenant/src/app/comms/[id]/act/page.tsx · THE BROADCAST MUTATE CHAIN — W2845 confirm → W2846 success → W2847
// failure · PC-56 TENANT-8e.
//
// The canon's mutate chain on the `whatsapp` module lists eleven acts. ONE is a real act on this platform — *Send broadcast*
// (as an in-app announcement) — and the act a scheduled send needs is its cancel. Both live here (`?act=send|cancel`). The
// other nine are refused by name on the screens that draw them (connect / disconnect number, submit for review to Meta,
// free-form send, assign, mark resolved, duplicate, archive override — the last two are 8a's template acts at
// `/content/templates/[id]/act`; *Retry* is a page load, *Unassigned* a tab count).
// The confirm step is the API's verdict for the broadcast AS IT STANDS (the typed reason judged on its own line), and for a
// send the honest maths once more (audience now, the frame's templates, the quiet-hours estimate at the send instant). The
// act re-takes the verdict under the row lock. THE KEY IS MINTED HERE AND CARRIED IN THE FORM (F-17).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { BroadcastActs } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { auditHref, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../features/mutate/chain';
import { COMMS_HREF, broadcastActHref, broadcastActPath, broadcastHref, channelKey, gapParts, isBroadcastAct, statusKey, transportState } from '../../../../features/comms/broadcasts';
import { broadcastActAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('bc.act.title'), robots: { index: false, follow: false } };
}

export default async function BroadcastActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(broadcastActPath(params.id));
  const t = getTranslator();
  const lang = getLang();
  const act = isBroadcastAct(searchParams.act) ? searchParams.act : 'send';
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim();
  let acts: BroadcastActs | null = null; let state = 'data';
  if (step === 'confirm') {
    try { acts = await tenantClient().notifications.broadcastActs(params.id, reason.length > 0 ? reason : undefined); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = transportState(err?.code, err?.status); }
  }
  const verdict = acts?.verdicts.find((v) => v.act === act) ?? null;
  const rs = reasonState(reason);
  const zoned = (iso: string | null | undefined, zone?: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone ?? undefined }) : null);
  const b = acts?.view.broadcast ?? null;
  const p = acts?.preview ?? null;

  return (
    <section>
      <h1>{t.t(`bc.act.title.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('bc.form.module')}</p>
      <p className="kv-field__hint"><Link href={broadcastHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {step === 'confirm' && !acts && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="status"><p>{t.t(`bc.state.${state}`)}</p></div>}
      {step === 'confirm' && b && verdict && (
        <>
          <div className="kv-card">
            <h2>{b.title}</h2>
            <p>{t.t(statusKey(b.status))} · {t.t(channelKey(b.channel))} · {b.audienceRoleCode ? <code>{b.audienceRoleCode}</code> : t.t('bc.audience.everyone')}{b.scheduledAt && <> · {t.t('bc.scheduledFor')} {zoned(b.scheduledAt, acts!.view.zone)}</>}</p>
            {act === 'send' && <p className="kv-field__hint">{t.t(b.scheduledAt ? 'bc.act.send.scheduledEffect' : 'bc.act.send.nowEffect')}</p>}
            {act === 'cancel' && <p className="kv-field__hint">{t.t('bc.act.cancel.effect')}</p>}
          </div>
          {act === 'send' && p && (
            <div className="kv-card">
              <h2>{t.t('bc.maths.title')}</h2>
              <p>{t.t('bc.act.send.reaches', { n: formatNumber(p.audience.size, lang) })}</p>
              <p>{p.templates.sendable ? t.t('bc.maths.templatesOk', { n: formatNumber(p.templates.required.length, lang) }) : <span className="kv-error">{t.t('bc.maths.templatesGap')} {p.templates.gaps.map((g) => `${t.t(channelKey(gapParts(g).channel))} · ${gapParts(g).language}`).join(', ')}</span>}</p>
              {p.impact && p.impact.channels.filter((ch) => ch.channel === 'push').map((ch) => (
                <p key={ch.channel}>{t.t('bc.act.send.pushLine', { now: formatNumber(ch.now, lang), held: formatNumber(ch.held, lang), off: formatNumber(ch.optedOut, lang), nodev: formatNumber(ch.noDevice, lang) })}</p>
              ))}
              {p.impact?.heldUntil && <p className="kv-field__hint">{t.t('bc.impact.heldUntil', { at: zoned(p.impact.heldUntil, p.zone) ?? '' })}</p>}
              <p className="kv-field__hint">{t.t('bc.act.send.noChecker')}</p>
            </div>
          )}
          {verdict.refusals.filter((r) => !r.startsWith('REASON_')).map((r) => <div className="kv-error" role="alert" key={r}><p>{t.t(`mutate.broadcast.refusal.${r}`)}</p></div>)}

          <form action={broadcastActPath(params.id)} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" /><input type="hidden" name="act" value={act} />
            <label className="kv-field" htmlFor="r"><span>{t.t('bc.act.reasonLabel')}</span><textarea id="r" name="reason" className="kv-textarea" rows={2} defaultValue={reason} maxLength={300} required /></label>
            {reasonStateKey(rs) && reason.length > 0 && <p className="kv-error">{t.t(reasonStateKey(rs)!)}</p>}
            <button type="submit" className="kv-btn kv-btn--secondary">{t.t('mutate.reason.check')}</button>
          </form>
          {verdict.allowed && rs === 'ok' ? (
            <form action={broadcastActAction} className="kv-card">
              <input type="hidden" name="id" value={params.id} /><input type="hidden" name="act" value={act} /><input type="hidden" name="reason" value={reason} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t(`bc.act.proceed.${act}`)}</button>
              <p className="kv-field__hint">{t.t('bc.act.recorded')}</p>
            </form>
          ) : <p className="kv-field__hint">{t.t(verdict.allowed ? 'bc.act.reasonFirst' : 'bc.act.notAllowed')}</p>}
          <p><Link href={broadcastHref(params.id)} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(`bc.act.done.${act}${act === 'send' && searchParams.to === 'scheduled' ? '.scheduled' : ''}`)}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p><Link href={broadcastHref(params.id)} className="kv-btn kv-btn--primary">{t.t('bc.act.openReceipt')}</Link>{' · '}<Link href={auditHref('tenant_broadcast', params.id)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>
          <p><Link href={COMMS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} <code>{searchParams.error}</code></p>
          {(searchParams.refusals ?? '').split(',').filter(Boolean).map((r) => <p key={r}>{t.t(`mutate.broadcast.refusal.${r}`)}</p>)}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${broadcastActHref(params.id, act)}&reason=${encodeURIComponent(reason)}`} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={broadcastHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
