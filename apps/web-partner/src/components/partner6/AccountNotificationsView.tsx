// apps/web-partner/src/components/partner6/AccountNotificationsView.tsx · PC-56 PARTNER-6c · W270 (canon `account/notifications`) — AN HONEST
// PAGE THAT READS NOTHING (founder 6c-1, door Q5-A), presentational, for EVERY partner person.
//
// What the platform sends the people of a partner organisation — two kinds of message, by SMS: the sign-in code and the team invitation —
// and that nothing else is sent in this console; the organisation's machine notifications are its webhooks, set up by the platform, with a
// REAL link to their delivery log (`/account/webhooks`, PARTNER-1b). The canon's principle "what you see is what was actually sent" survives
// ONLY as that pointer. NO inbox, NO item, NO counter, NO person (never a policyholder, payee, vet or surveyor), NO place, NO event code, NO
// "critical breaks through", NO grouped summary, NO `<select>`, NO input. No read → no audit row and NO error state (the W217 / 5b rule); the
// state is the public flag map (`partner_console` OFF prints OFF). "Mark all read" is DECOR → the W2967–W2969 chain, refused by name.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { Refusals6 } from './LenderChain6';
import { NOTIFICATIONS_PAGE, NOTIFICATION_PREFS_PAGE, WEBHOOKS_PAGE, type AccountState } from '../../features/partner6/figures';

export function AccountSwitchedOff({ t, page }: { t: Tr; page: string }) {
  return (
    <section data-kv-account={page} data-kv-state="off">
      <h1>{t.t('partner.off.title')}</h1>
      <p className="kv-muted">{t.t('partner.off.body')}</p>
    </section>
  );
}

export function AccountNotificationsView({ t, state }: { t: Tr; state: AccountState }) {
  if (state === 'off') return <AccountSwitchedOff t={t} page="notifications" />;
  return (
    <section data-kv-account="notifications" data-kv-state={state}>
      <h1>{t.t('partner6.notifications.title')}</h1>
      <p className="kv-muted">{t.t('partner6.notifications.lead')}</p>

      <div className="kv-card" data-kv-statement="notifications">
        <h2 className="kv-card__title">{t.t('partner6.notifications.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner6.notifications.statement">{t.t('partner6.notifications.statement')}</p>
        <p className="kv-pager" data-kv-acts="webhooks">
          <Link className="kv-btn kv-btn--muted" href={WEBHOOKS_PAGE} data-kv-real="webhooks">{t.t('partner6.notifications.webhooksLink')}</Link>
        </p>
      </div>

      <p className="kv-pager" data-kv-acts="notifications">
        <Link className="kv-btn kv-btn--muted" href={NOTIFICATION_PREFS_PAGE} data-kv-real="preferences">{t.t('partner6.notifications.prefsLink')}</Link>
        <Link className="kv-btn kv-btn--muted" href={`${NOTIFICATIONS_PAGE}?act=confirm`} data-kv-decor="mark-all-read">{t.t('partner6.notifications.markAllRead')}</Link>
      </p>
      <Refusals6 t={t} surface="notifications" />
    </section>
  );
}
