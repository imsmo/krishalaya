// apps/web-partner/src/components/partner1/MailboxLine.tsx · PC-56 PARTNER-1b — "write to the partners mailbox": the platform's partners mailbox
// FACT (`GET /v1/storefront/platform-facts` → `contact.partnersEmail`, read by lib/partners-mailbox.ts), or "not published yet". No mailbox
// literal lives in this app (the brand guard scans src/). Presentational.
import type { Tr } from '../NotYet';
import type { Mailbox } from './HelpView';

export function MailboxLine({ t, mailbox }: { t: Tr; mailbox: Mailbox }) {
  return (
    <p className="kv-field__hint" data-kv-ops-mailbox={mailbox.kind}>
      {mailbox.kind === 'published' && <>{t.t('partner1.ops.mailbox')} <a className="kv-link" href={`mailto:${mailbox.address}`}>{mailbox.address}</a></>}
      {mailbox.kind === 'none' && t.t('partner1.ops.mailboxNone')}
      {mailbox.kind === 'error' && t.t('partner1.ops.mailboxError')}
    </p>
  );
}
