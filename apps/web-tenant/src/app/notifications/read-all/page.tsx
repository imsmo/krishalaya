// apps/web-tenant/src/app/notifications/read-all/page.tsx · the notifications MUTATE chain — W2690 confirm → W2691 success
// → W2692 failure (W204's *Mark all read*) · PC-56 TENANT-8b.
//
// W2690 names two acts: *"Mark all read · Retry"*. MARK ALL READ is real: the confirm step shows how many it clears (a live
// count of YOUR unread in-app items), the key is minted here and travels in the form (F-17), the server moves exactly the
// statuses the state machine lets become `read` in one statement and writes ONE audit row with the count. *Retry* (W204's
// "Couldn't load inbox → Retry") is a page load — refused as an act by name (6a's ruling). Marking read never re-sends or
// un-sends anything on any other channel (the canon's own sentence, and true: it touches in-app rows only).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { auditHref, canLinkAudit, failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../features/mutate/chain';
import { INBOX_HREF, READ_ALL_HREF, canConfirmAct, inboxTransportState, pageStateKey, refusedKey } from '../../../features/notifications/inbox';
import { markAllReadAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.act.readAll'), robots: { index: false, follow: false } };
}

export default async function ReadAllPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(READ_ALL_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const marked = typeof searchParams.marked === 'string' ? Number(searchParams.marked) : 0;
  let count = 0; let previewState: string | null = null;
  if (step === 'confirm') {
    try { count = (await tenantClient().notifications.readAllPreview()).unread; }
    catch (e) { previewState = pageStateKey(e instanceof SdkError ? inboxTransportState(e.code, e.status) : 'error'); }
  }
  const me = step === 'success' ? await tenantClient().auth.me().catch(() => null) : null;
  const n = (v: number) => formatNumber(Number.isFinite(v) ? v : 0, lang);

  return (
    <section>
      <h1>{t.t('notif.act.readAll')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('mutate.notifs.module')}</p>
      <p className="kv-field__hint"><Link href={INBOX_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {step === 'confirm' && previewState && <div className="kv-error" role="alert"><p>{t.t(previewState)}</p></div>}
      {step === 'confirm' && !previewState && (
        <>
          <div className="kv-card">
            <p>{t.t('mutate.notif.clears', { n: n(count) })}</p>
            <p className="kv-field__hint">{t.t('mutate.notif.neverResends')}</p>
            <p className="kv-field__hint">{t.t('mutate.notif.recorded')}</p>
          </div>
          {canConfirmAct(count) ? (
            <form action={markAllReadAction}>
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('mutate.notif.nothingUnread')}</p>}
          <p><Link href={INBOX_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
          <p className="kv-field__hint">{t.t(refusedKey('retryPageLoad'))}</p>
        </>
      )}
      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('notif.actDone.readAll', { n: n(marked) })}</p>
          <p className="kv-field__hint">{t.t('mutate.notif.auditNote')}</p>
          {me && canLinkAudit('notification_inbox', me.id) && <p><Link href={auditHref('notification_inbox', me.id)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={INBOX_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${READ_ALL_HREF}?step=confirm`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={INBOX_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
