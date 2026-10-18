// apps/web-partner/src/components/partner1/HelpView.tsx · PC-56 PARTNER-1a · founder D4 — HELP & SUPPORT (canon W272), presentational.
//
// The ONE channel: the platform's partners mailbox, read from the platform facts (`GET /v1/storefront/platform-facts`, `contact.partnersEmail`)
// and printed as a mailto link — or "not published yet". No mailbox literal exists in this app (F-8; the brand guard scans src/). "Business
// hours" is gone (unprovable). The static article "Verifying webhook signatures" prints the delivery rail's own constants
// (features/partner1/webhook-contract.ts, pinned to the rail by a parity spec) — no figure is typed into a sentence. "Raise a ticket" leads
// to the DECOR chain (W2937–W2940: "write to the mailbox"); search, the article library, versions, tickets, severity hours, the pager, the
// phone line, one-thread and the rating are refused by name.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { RefusalList } from './RefusalList';
import { WEBHOOK_CONTRACT as W } from '../../features/partner1/webhook-contract';

export type Mailbox = { kind: 'published'; address: string } | { kind: 'none' } | { kind: 'error' };

export function HelpView({ t, mailbox }: { t: Tr; mailbox: Mailbox }) {
  return (
    <section data-kv-help={mailbox.kind}>
      <h1>{t.t('partner1.help.title')}</h1>
      <p className="kv-muted">{t.t('partner1.help.lead')}</p>

      <div className="kv-card" data-kv-mailbox={mailbox.kind}>
        <h2 className="kv-card__title">{t.t('partner1.help.mailboxTitle')}</h2>
        {mailbox.kind === 'published' && <p>{t.t('partner1.help.mailboxBody')} <a className="kv-link" href={`mailto:${mailbox.address}`}>{mailbox.address}</a></p>}
        {mailbox.kind === 'none' && <p>{t.t('partner1.help.mailboxNone')}</p>}
        {mailbox.kind === 'error' && <p role="alert">{t.t('partner1.help.mailboxError')} <Link className="kv-link" href="/help?retry=confirm">{t.t('partner1.dash.retry')}</Link></p>}
        <p className="kv-field__hint">{t.t('partner1.help.include')}</p>
        <p><Link className="kv-btn kv-btn--muted" href="/help?ticket=review" data-kv-decor="ticket">{t.t('partner1.help.ticket')}</Link></p>
        <p className="kv-field__hint">{t.t('partner1.help.ticketRefused')}</p>
      </div>

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('partner1.help.integrationTitle')}</h2>
        <p>{t.t('partner1.help.integrationBody')}</p>
      </div>

      <article className="kv-card kv-article" data-kv-article="webhook-signatures">
        <h2 className="kv-card__title">{t.t('partner1.help.article.title')}</h2>
        <p>{t.t('partner1.help.article.lead')}</p>
        <ul>
          <li>{t.t('partner1.help.article.header', { header: W.signatureHeader, legacy: W.legacySignatureHeader })}</li>
          <li>{t.t('partner1.help.article.format', { format: W.headerFormat })}</li>
          <li>{t.t('partner1.help.article.algorithm', { algorithm: W.algorithm, signed: W.signedString })}</li>
          <li>{t.t('partner1.help.article.tolerance', { seconds: W.toleranceSec })}</li>
          <li>{t.t('partner1.help.article.rotation', { hours: W.rotationOverlapHours })}</li>
          <li>{t.t('partner1.help.article.retries', { ladder: W.retryLadderLabels.join(' · '), attempts: W.maxAttempts })}</li>
          <li>{t.t('partner1.help.article.timeout', { seconds: W.sendTimeoutSec })}</li>
        </ul>
      </article>

      <RefusalList t={t} surface="help" />
    </section>
  );
}
