// apps/web-storefront/src/app/[tenantSlug]/messages/[id]/report/[messageId]/page.tsx · PC-56 STORE-4b · C3 — the REPORT chain, canon W3109
// (confirm) → W3110 (success, on the thread: ?status=reported) / W3111 (failure, here: ?failure=…). REAL (founder D2a). PROTECTED + dynamic.
//   • this store's `communication` flag OFF → the honest sentence and no act;
//   • the confirm: the reason — a select over the platform's `report_reason` vocabulary (`lookups.values('report_reason')`, labels FROM the
//     vocabulary; i18n for the sentence only), the sentence "Reporting hides this message from you pending review — the reporter is never
//     shown", the key MINTED AT RENDER (`report:<uuid>`), Proceed / Cancel (back to the thread);
//   • W3111: the failure by name (the message is gone or not yours to see · your own message · not a reason · switched off · server) with
//     Retry carrying the SAME key and the chosen reason;
//   • a thread that is not the buyer's → notFound(); the vocabulary unreadable → said, with a Retry (a reload) — never a guessed list;
//   • block, the safety desk and on-call paging are refused by name (surface `report`).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { randomUUID } from 'crypto';
import type { Conversation, LookupValue, StorefrontFlags } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { getTranslator } from '../../../../../../lib/i18n';
import { reloadHref } from '../../../../../../features/home/load-result';
import { readReportQuery, reportHref, threadHref } from '../../../../../../features/store4b/thread';
import { RefusalList } from '../../../../../../components/RefusalList';
import { reportMessageAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store4b.report.title'), robots: { index: false, follow: false } };
}

export default async function ReportMessagePage({ params, searchParams }: { params: { tenantSlug: string; id: string; messageId: string }; searchParams: SP }) {
  const { tenantSlug: slug, id, messageId } = params;
  await requireSession(reportHref(slug, id, messageId));
  const t = getTranslator();
  const { failure, key: carried, reason: chosen } = readReportQuery(searchParams);
  const cancel = <Link href={threadHref(slug, id)} className="kv-btn--link" data-kv-cancel>{t.t('store4b.report.cancel')}</Link>;

  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags !== null && flags.communication !== true) {
    return (
      <section className="kv-thread" data-kv-screen="report" data-kv-store={slug}>
        <h1>{t.t('store4b.report.title')}</h1>
        <div className="kv-state" role="status" data-kv-state="off"><p>{t.t('store4b.messages.off')}</p></div>
        <RefusalList surface="report" />
      </section>
    );
  }

  let convo: Conversation | null = null;
  let reasons: LookupValue[] | null = null;
  if (flags !== null) {
    try { convo = await serverClient(slug).conversations.get(id); }
    catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); convo = null; }
    try { reasons = (await publicClient(slug).lookups.values('report_reason')).slice().sort((a, b) => a.sortOrder - b.sortOrder); } catch { reasons = null; }
  }
  if (!convo || !reasons || reasons.length === 0) {
    return (
      <section className="kv-thread" data-kv-screen="report" data-kv-store={slug}>
        <h1>{t.t('store4b.report.title')}</h1>
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store4b.report.loadError')}</p>
          <a href={reloadHref(reportHref(slug, id, messageId), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <p>{cancel}</p>
        <RefusalList surface="report" />
      </section>
    );
  }

  const key = carried ?? `report:${randomUUID()}`;   // W3111's Retry carries the SAME key; a fresh confirm mints one now
  return (
    <section className="kv-thread" data-kv-screen="report" data-kv-step={failure ? 'failure' : 'confirm'} data-kv-store={slug}>
      <h1>{t.t('store4b.report.title')}</h1>
      {failure && (
        <div className="kv-state kv-state--error" role="alert" data-kv-failure={failure}>
          <p><strong>{t.t('store4b.report.failureTitle')}</strong></p>
          <p>{t.t(`store4b.report.failure.${failure}`)}</p>
        </div>
      )}
      <p data-kv-sentence="hidden">{t.t('store4b.report.sentence')}</p>
      <form action={reportMessageAction} className="kv-form" data-kv-form="report">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="conversationId" value={id} />
        <input type="hidden" name="messageId" value={messageId} />
        <input type="hidden" name="key" value={key} />
        <label htmlFor="report-reason" className="kv-form__label">{t.t('store4b.report.reason')}</label>
        <select id="report-reason" name="reason" className="kv-field__input" defaultValue={chosen ?? ''} required>
          <option value="" disabled>{t.t('store4b.report.choose')}</option>
          {reasons.map((r) => <option key={r.code} value={r.code} data-kv-reason={r.code}>{r.name}</option>)}
        </select>
        <div className="kv-cart__actions">
          <button type="submit" className="kv-btn" data-kv-act={failure ? 'retry' : 'proceed'}>{t.t(failure ? 'store4b.report.retry' : 'store4b.report.proceed')}</button>
          {cancel}
        </div>
      </form>
      <RefusalList surface="report" />
    </section>
  );
}
