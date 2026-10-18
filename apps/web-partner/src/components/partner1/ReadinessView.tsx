// apps/web-partner/src/components/partner1/ReadinessView.tsx · PC-56 PARTNER-1b · founder D3 — YOUR STANDING WITH THE PLATFORM (canon W266 at
// `onboarding/status`), presentational, over `GET /v1/partner/readiness`: six facts read from what exists — the organisation is active, an
// administrator uses an authenticator app, keys issued, an endpoint registered, a delivery reached the partner's server in the window, the
// decision promise published — with the server's `computedAt`. A fact not yet in place is "with the platform's partner operations" beside the
// partners mailbox fact. NOTHING is stored, ticked or promised: no application number, no checklist, no agreement signing, no desk or clock,
// no key by mail, no separate test world — each refused by name. The settlement page is linked from here only.
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { PartnerReadiness } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import type { Mailbox } from './HelpView';
import { MailboxLine } from './MailboxLine';
import { RefusalList } from './RefusalList';
import { asOfText } from '../../features/partner1/dashboard';
import { readinessRows, readyCount } from '../../features/partner1/readiness';

export type ReadinessState = 'ok' | 'error' | 'off';

export function ReadinessView({ t, lang, state, r, mailbox }: { t: Tr; lang: string; state: ReadinessState; r: PartnerReadiness | null; mailbox: Mailbox }) {
  if (state === 'off') return <section data-kv-readiness="off"><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;
  const last = r?.deliveries.lastDeliveredAt ? formatDate(r.deliveries.lastDeliveredAt, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '';
  const rows = r ? readinessRows(r, last) : [];
  return (
    <section data-kv-readiness={state === 'ok' && r ? 'ok' : 'error'}>
      <h1>{t.t('partner1.readiness.title')}</h1>
      <p className="kv-muted">{t.t('partner1.readiness.lead')}</p>
      {(state === 'error' || !r) ? <p role="alert">{t.t('partner1.readiness.error')} <Link className="kv-link" href="/onboarding/status">{t.t('partner1.readiness.retry')}</Link></p> : (
        <div className="kv-card" data-kv-readiness-facts>
          <p className="kv-field__hint">{t.t('partner1.asOf', { time: asOfText(r.computedAt, lang) })} · {t.t('partner1.readiness.count', { ready: readyCount(rows), total: rows.length })}</p>
          <ul className="kv-facts-list">{rows.map((x) => (
            <li key={x.id} data-kv-fact={x.id} data-kv-ready={x.ready ? 'yes' : 'no'}>
              <span className={`kv-badge${x.ready ? ' kv-badge--ok' : ''}`}>{t.t(x.ready ? 'partner1.readiness.ready' : 'partner1.readiness.withOps')}</span>{' '}
              {t.t(x.key, x.vars)}
            </li>
          ))}</ul>
          <MailboxLine t={t} mailbox={mailbox} />
        </div>
      )}
      <div className="kv-card" data-kv-readiness-links>
        <p><Link className="kv-link" href="/account/api">{t.t('partner1.nav.keys')}</Link> · <Link className="kv-link" href="/account/webhooks">{t.t('partner1.nav.webhooks')}</Link> · <Link className="kv-link" href="/account/settings">{t.t('partner1.nav.settings')}</Link></p>
        <p><Link className="kv-link" href="/onboarding/settlement" data-kv-settlement-link>{t.t('partner1.readiness.settlementLink')}</Link> <span className="kv-muted">{t.t('partner1.readiness.settlementHint')}</span></p>
      </div>
      <RefusalList t={t} surface="status" />
    </section>
  );
}
