// apps/web-admin/src/app/templates/senders/page.tsx · what W102's "sender ID KRISHIV" refers to (PC-56 ADMIN-11b).
//
// **THE STATUS ON EVERY ROW HERE IS AN OPERATOR'S ASSERTION, NOT A PROVIDER'S CONFIRMATION.** No SMS, WhatsApp, email or
// voice provider is wired in this monorepo — no DLT ids, no MT engine — so nothing can verify that a header is really
// registered. The registry is still worth having: it is the record of what was registered, and it gives a template's
// provider ref something to belong to. What it must never do is let a reader believe the registration was checked, which
// would make it the status-recording-an-act-nobody-performs shape in the very wave that names it (ADMIN-11b-Q2).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { channelKey } from '../../../features/templates/template';
import { registerSenderAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tp11.senders'), robots: { index: false, follow: false } };
}

interface Sender {
  id: string; channel: string; sender: string; entityId: string | null; countryCode: string;
  provider: string | null; status: string; verifiedByProviderAt: string | null; providerVerified: boolean; note: string | null;
}

export default async function SendersPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  let rows: Sender[] = []; let notice: string | undefined; let owner = '';
  try {
    const res = await adminGet<Sender[]>('templates/senders');
    rows = res.data ?? []; owner = String((res.meta as { verificationOwner?: string } | undefined)?.verificationOwner ?? '');
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'tp11.restricted' : 'tp11.error.senders';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/templates">{t.t('tp11.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('tp11.senders')}</span>
      </nav>
      <header className="kv-page__head">
        <h1>{t.t('tp11.senders')}</h1>
        <p className="kv-page__sub">{t.t('tp11.senders.sub')}</p>
      </header>
      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`tp11.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`tp11.err.${searchParams.error}`)}</p> : null}

      {/* THE HONESTY LINE, above the table rather than under it. */}
      <p className="kv-note is-warn">{t.t('tp11.senders.unverified', { owner })}</p>

      {rows.length === 0 && !notice ? (
        <div className="kv-empty">
          <h2>{t.t('tp11.senders.empty')}</h2>
          <p>{t.t('tp11.senders.emptyBody')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('tp11.senders.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('tp11.col.sender')}</th>
              <th scope="col">{t.t('tp11.col.channel')}</th>
              <th scope="col">{t.t('tp11.col.country')}</th>
              <th scope="col">{t.t('tp11.col.entity')}</th>
              <th scope="col">{t.t('tp11.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="kv-mono">{s.sender}{s.note ? <><br /><small>{s.note}</small></> : null}</td>
                <td>{t.t(channelKey(s.channel))}</td>
                <td className="kv-mono">{s.countryCode}</td>
                <td className="kv-mono">{s.entityId ?? '—'}</td>
                <td>
                  <span className="kv-badge">{s.status}</span>
                  {/* Verified BY A PROVIDER is a separate fact from the status an operator set, and it is the one a
                      reader assumes. It is printed as absent rather than left off the row. */}
                  <br /><small>{s.providerVerified ? t.t('tp11.senders.verified') : t.t('tp11.senders.notVerified')}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="kv-panel" aria-labelledby="tp11-newsender">
        <h2 id="tp11-newsender" className="kv-panel__title">{t.t('tp11.senders.add')}</h2>
        <form action={registerSenderAction}>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="tp11-s-channel">{t.t('tp11.col.channel')}</label>
            <select className="kv-input" id="tp11-s-channel" name="channel" defaultValue="sms">
              {['sms', 'whatsapp', 'email', 'ivr'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="tp11-s-sender">{t.t('tp11.col.sender')}</label>
            <input className="kv-input" id="tp11-s-sender" name="sender" required minLength={3} maxLength={120} />
            <p className="kv-field__help">{t.t('tp11.senders.senderHelp')}</p>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="tp11-s-country">{t.t('tp11.col.country')}</label>
            <input className="kv-input" id="tp11-s-country" name="countryCode" required maxLength={2} defaultValue="IN"
              pattern="[A-Za-z]{2}" aria-describedby="tp11-s-country-help" />
            <p className="kv-field__help" id="tp11-s-country-help">{t.t('tp11.senders.countryHelp')}</p>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="tp11-s-entity">{t.t('tp11.col.entity')}</label>
            <input className="kv-input" id="tp11-s-entity" name="entityId" maxLength={60} />
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="tp11-s-reason">{t.t('tp11.reason')}</label>
            <input className="kv-input" id="tp11-s-reason" name="reason" required minLength={20} maxLength={2000} />
          </div>
          <button className="kv-btn" type="submit">{t.t('tp11.senders.submit')}</button>
        </form>
      </section>
    </main>
  );
}
