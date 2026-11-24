// apps/web-admin/src/app/login/key/page.tsx · god-mode sign-in, step 2 of 2: the hardware key (PC-56 ADMIN-AUTH-1).
//
// admin-api's IdP callback lands here with `?ticket=` — a single-use, 5-minute proof that the IdP step succeeded for ONE
// operator. It is worth nothing without that operator's hardware key. A malformed ticket never leaves this server; an
// expired or used one is refused by admin-api and the screen says "start again". An operator with no key yet sees the
// enrollment form instead (a one-time code from a colleague, or the founder's bootstrap code for the very first key).
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { authCopy, isTicket } from '../../../features/admin-auth/admin-auth';
import { KeyCeremony } from '../../../components/auth/KeyCeremony';
import { Button, Callout } from '@krishalaya/ui';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('loginKey.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function LoginKeyPage(props: { searchParams: Promise<{ ticket?: string }> }) {
  const { ticket } = await props.searchParams;
  const t = getTranslator();
  return (
    <section className="kv-login">
      <h1>{t.t('loginKey.title')}</h1>
      {isTicket(ticket) ? (
        <KeyCeremony ticket={ticket} copy={authCopy((k) => t.t(k))} />
      ) : (
        <>
          <Callout tone="danger" live="assertive">{t.t('loginKey.err.ticket')}</Callout>
          <p className="kv-login__cta"><Button as="a" href="/login">{t.t('loginKey.startAgain')}</Button></p>
        </>
      )}
      <p className="kv-muted">{t.t('loginKey.note')}</p>
    </section>
  );
}
