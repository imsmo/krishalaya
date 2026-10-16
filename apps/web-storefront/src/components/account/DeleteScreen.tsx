// apps/web-storefront/src/components/account/DeleteScreen.tsx · PC-56 STORE-4a · C5 — the DELETION request on the W3031–W3033 confirm → success →
// failure SHAPE (a recorded DELTA: W300's "Delete my account…" has no canon chain of its own; W300's "Delete confirm" state is the body), under
// whichever chrome the person is in (one copy). PROTECTED + dynamic. Every figure is the SERVER's (`privacy.commitments()`):
//   • BLOCKED (founder D1) → "N orders must complete first · X held in escrow · wallet balance Y — pay it out first" (money in the DATA's
//     currency) and NO submit — nothing moves, the wallet is paid out by the person through the payout flow;
//   • ALLOWED → "kept by law: N invoices for R years" (R = the platform setting `platform.invoice_retention_years`, never a literal) ·
//     "everything else is erased by the platform's data-protection desk after the N-day cooling period" (founder D3 — the date is set when you
//     confirm) · "this action is recorded" (TRUE: `dsr.requested`) → Confirm (a key minted at render);
//   • SUCCESS (W3032's shape) → the request and its cooling date; FAILURE (W3033's) → named (blocked on a race / concurrency / server), the
//     same key on Retry; "within 30 days" refused by name.
import { randomUUID } from 'crypto';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { PrivacyCommitments, PrivacyRequest } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { moneyText } from '../../features/discovery/money';
import { reloadHref } from '../../features/home/load-result';
import { accountHref, chromeField, readOne, type AccountChrome } from '../../features/store4a/account';
import { deletionView, openDeletion, DELETE_FAILURES } from '../../features/store4a/data-rights';
import { requestDeletionAction } from '../../app/(platform)/account/actions';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function DeleteScreen({ chrome, searchParams }: { chrome: AccountChrome; searchParams: SP }) {
  await requireSession(accountHref(chrome, 'delete'));
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined);
  let c: PrivacyCommitments | null = null;
  try { c = await api.privacy.commitments(); } catch { c = null; }
  let requests: PrivacyRequest[] = [];
  try { requests = await api.privacy.myRequests(); } catch { requests = []; }
  const open = openDeletion(requests as never);
  const ok = readOne(searchParams.ok, ['requested'] as const);
  const failure = readOne(searchParams.failure, DELETE_FAILURES);
  const key = (() => { const k = one(searchParams.k); return typeof k === 'string' && /^dsr-delete:[0-9a-f-]{36}$/.test(k) ? k : `dsr-delete:${randomUUID()}`; })();
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'long' }) : '');
  const money = (minor: string | null, ccy: string | null) => (minor ? moneyText(minor, ccy, lang) ?? t.t('money.unavailable') : null);

  const head = (
    <>
      <nav aria-label={t.t('store4a.crumb.label')}><ol className="kv-crumb"><li><Link href={accountHref(chrome)}>{t.t('account.title')}</Link></li><li aria-current="page">{t.t('store4a.delete.title')}</li></ol></nav>
      <h1>{t.t('store4a.delete.title')}</h1>
    </>
  );

  // an open request (just made, or made before): said with its cooling date — no second confirm
  if (open) {
    return (
      <section className="kv-delete" data-kv-screen="delete" data-kv-state="requested" data-kv-chrome={chromeField(chrome)}>
        {head}
        {ok && <p className="kv-form__notice" role="status" data-kv-ok="requested">{t.t('store4a.delete.ok')}</p>}
        <p data-kv-cooling-ends={open.coolingEndsAt ?? ''}>{open.coolingEndsAt ? t.t('store4a.delete.coolingUntil', { date: date(open.coolingEndsAt) }) : t.t('store4a.delete.coolingUnknown')}</p>
        <p className="kv-detail__muted">{t.t('store4a.delete.desk')}</p>
        <Link href={accountHref(chrome)} className="kv-btn--link">{t.t('store4a.data.back')}</Link>
        <RefusalList surface="delete" />
      </section>
    );
  }
  if (!c) {
    return (
      <section className="kv-delete" data-kv-screen="delete" data-kv-state="error" data-kv-chrome={chromeField(chrome)}>
        {head}
        <div className="kv-state kv-state--error" role="alert">
          <p>{t.t('store4a.delete.error')}</p>
          <a href={reloadHref(accountHref(chrome, 'delete'), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="delete" />
      </section>
    );
  }
  const v = deletionView(c);
  return (
    <section className="kv-delete" data-kv-screen="delete" data-kv-state={v.blocked ? 'blocked' : 'allowed'} data-kv-chrome={chromeField(chrome)}>
      {head}
      {failure && <p className="kv-form__error" role="alert" data-kv-failure={failure}>{t.t(`store4a.delete.failure.${failure}`)}</p>}
      {v.blocked ? (
        <div className="kv-state" role="status" data-kv-blocked>
          <p><strong>{t.t('store4a.delete.blocked')}</strong></p>
          <ul>
            {v.openOrders > 0 && <li data-kv-open-orders={v.openOrders}>{t.t('store4a.delete.openOrders', { n: formatNumber(v.openOrders, lang) })}</li>}
            {v.escrowMinor && <li data-kv-escrow={v.escrowMinor} data-kv-money={v.currencyCode ?? 'unknown'}>{t.t('store4a.delete.escrow', { amount: money(v.escrowMinor, v.currencyCode)! })}</li>}
            {v.walletMinor && <li data-kv-wallet={v.walletMinor} data-kv-money={v.currencyCode ?? 'unknown'}>{t.t('store4a.delete.wallet', { amount: money(v.walletMinor, v.currencyCode)! })}</li>}
          </ul>
          {v.multiCurrency && <p className="kv-detail__muted">{t.t('store4a.delete.multiCurrency')}</p>}
          <p className="kv-detail__muted">{t.t('store4a.delete.nothingMoves')}</p>
          <Link href={accountHref(chrome)} className="kv-btn--link">{t.t('store4a.data.back')}</Link>
        </div>
      ) : (
        <div className="kv-form__card" data-kv-confirm="delete">
          <p data-kv-kept={v.invoiceCount}>{v.retentionYears
            ? t.t('store4a.delete.kept', { n: formatNumber(v.invoiceCount, lang), years: formatNumber(v.retentionYears, lang) })
            : t.t('store4a.delete.keptNoYears', { n: formatNumber(v.invoiceCount, lang) })}</p>
          <p data-kv-cooling-days={v.coolingDays}>{t.t('store4a.delete.erased', { days: formatNumber(v.coolingDays, lang) })}</p>
          <p className="kv-detail__muted" data-kv-recorded>{t.t('store4a.delete.recorded')}</p>
          <form action={requestDeletionAction} className="kv-inline-form">
            <input type="hidden" name="chrome" value={chromeField(chrome)} />
            <input type="hidden" name="key" value={key} />
            <button type="submit" className="kv-btn" data-kv-submit="delete">{t.t(failure ? 'store4a.mutate.retry' : 'store4a.delete.confirm')}</button>
          </form>
          <Link href={accountHref(chrome)} className="kv-btn--link" data-kv-cancel>{t.t('store4a.mutate.cancel')}</Link>
        </div>
      )}
      <RefusalList surface="delete" />
    </section>
  );
}
