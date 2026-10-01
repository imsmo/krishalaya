// apps/web-tenant/src/app/notifications/act/page.tsx · the notification MUTATE chain — W2687 confirm → W2688 success →
// W2689 failure · PC-56 TENANT-8b.
//
// W2687 names six acts on this module: *"Archive · Hide thread · Mark all read · Mark read · Retry · important"*. What
// each is, honestly:
//   • MARK READ (one item, or the center's selection) and MARK ALL READ — real acts, built: the confirm step shows the
//     OBJECT (the items, or how many it clears), the key is minted HERE and travels in the form (F-17), the server writes
//     one audit row per act with the actor and time (and, for all, the count — W431's receipt).
//   • ARCHIVE and HIDE THREAD — refused by name: `notifications` has no archive column and no `collapse_key`; kv_app holds
//     no grant that could write either.
//   • RETRY — a page load, not a mutation (6a's ruling): every "Couldn't load" state links to its own page.
//   • "important" — a tier CHIP the canon's flow-map captured as an act; it is a filter link on W431.
// THE REASON IS NOT ASKED: marking your own inbox read is not a decision anyone audits for its why (the canon's receipt
// prints a count and an actor), and a reason box here would fill the trail with "ok". It is a confirm step all the same.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { NotificationLadder } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { auditHref, canLinkAudit, failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../features/mutate/chain';
import {
  ACT_HREF, CENTER_HREF, MAX_PICKS, actDoneKey, actLabelKey, canConfirmAct, isAct, itemTitle, pairIdsAt, parsePicks, pickValue, refusedKey,
} from '../../../features/notifications/inbox';
import { inboxActAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.notif.title'), robots: { index: false, follow: false } };
}

const all = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);
const SHOWN = 10;

export default async function InboxActPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(ACT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const actRaw = typeof searchParams.act === 'string' ? searchParams.act : null;
  const act = isAct(actRaw) ? actRaw : null;
  const picks = [...parsePicks(all(searchParams.pick)), ...pairIdsAt(all(searchParams.id), all(searchParams.at))]
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i).slice(0, MAX_PICKS);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const n = (v: number) => formatNumber(v, lang);
  const c = tenantClient().notifications;

  let count = 0; let previewError: string | null = null; const shown: NotificationLadder[] = [];
  if (step === 'confirm' && act === 'readAll') {
    try { count = (await c.readAllPreview()).unread; } catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  if (step === 'confirm' && act === 'read') {
    count = picks.length;
    for (const p of picks.slice(0, SHOWN)) { if (p.at) { try { shown.push(await c.ladder(p.id, p.at)); } catch { /* not yours / gone — the act will say so */ } } }
  }
  const me = step === 'success' ? await tenantClient().auth.me().catch(() => null) : null;
  const doneId = typeof searchParams.id === 'string' ? searchParams.id : null;
  const marked = typeof searchParams.marked === 'string' ? Number(searchParams.marked) : 0;
  const eventLabel = (code: string) => { const k = `notif.event.${code.toLowerCase()}`; const v = t.t(k); return v === k ? code : v; };
  const retryQ = new URLSearchParams({ step: 'confirm', act: act ?? 'read' });
  for (const p of picks) retryQ.append('pick', pickValue(p));

  return (
    <section>
      <h1>{act ? t.t(actLabelKey(act)) : t.t('mutate.notif.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('mutate.notif.module')}</p>
      <p className="kv-field__hint"><Link href={CENTER_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>

      {step === 'confirm' && !act && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('mutate.notif.noAct')}</p>
          <p className="kv-field__hint">{t.t(refusedKey('archive'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('collapse'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('retryPageLoad'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('tierChipAct'))}</p>
        </div>
      )}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && act && !previewError && (
        <>
          <div className="kv-card">
            {act === 'readAll' ? <p>{t.t('mutate.notif.clears', { n: n(count) })}</p> : (
              <>
                <p>{t.t('mutate.notif.marks', { n: n(count) })}</p>
                {shown.length > 0 && <ul>{shown.map((l) => <li key={l.id}>{itemTitle(l) ?? eventLabel(l.eventCode)}</li>)}</ul>}
                {count > shown.length && <p className="kv-field__hint">{t.t('mutate.notif.more', { n: n(count - shown.length) })}</p>}
              </>
            )}
            <p className="kv-field__hint">{t.t('mutate.notif.neverResends')}</p>
            <p className="kv-field__hint">{t.t('mutate.notif.recorded')}</p>
          </div>
          {canConfirmAct(count) ? (
            <form action={inboxActAction}>
              <input type="hidden" name="act" value={act} />
              {picks.map((p) => <input type="hidden" name="pick" value={pickValue(p)} key={p.id} />)}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t(act === 'readAll' ? 'mutate.notif.nothingUnread' : 'mutate.notif.nothingPicked')}</p>}
          <p><Link href={CENTER_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(actDoneKey(act), { n: n(Number.isFinite(marked) ? marked : 0) }) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.notif.auditNote')}</p>
          {act === 'readAll' && me && canLinkAudit('notification_inbox', me.id) && <p><Link href={auditHref('notification_inbox', me.id)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          {act === 'read' && doneId && canLinkAudit('notification', doneId) && <p><Link href={auditHref('notification', doneId)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={CENTER_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t('mutate.notif.partial', { n: n(Number(searchParams.done ?? 0) || 0) })}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${ACT_HREF}?${retryQ.toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={CENTER_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
