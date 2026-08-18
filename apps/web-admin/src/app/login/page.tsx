// apps/web-admin/src/app/login/page.tsx · god-mode sign-in. Strong auth (FIDO2 hardware key + step-up) is
// performed by the admin IdP, NOT here — admin-api enforces the resulting claims on every call (Law 11). This page
// links to the IdP and explains the requirement; it never accepts a password in the UI. (In deployment the IdP
// redirects back with the session set via a server-side callback that calls setAdminSession.) All copy via i18n.
//
// DEV-56 Part 3: the real IdP path above (`/auth/sso/start`) does not exist anywhere in this codebase yet, so on
// a fresh checkout there was NO way to reach this console at all. `env.devLoginEnabled` (false unless a local
// dev deliberately sets ADMIN_DEV_LOGIN_ENABLED=true) additionally renders a second, clearly-labelled CTA that
// posts to /api/dev-login. The production path above is UNCHANGED — still points at the real IdP route, never
// faked, never removed. See dev-login.controller.ts and api/dev-login/route.ts for the safety case (Law 8).
import type { Metadata } from 'next';
import { env } from '../../lib/env';
import { getTranslator } from '../../lib/i18n';

import { Button } from '@krishalaya/ui';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('login.title'), robots: { index: false, follow: false } };
}

export default function AdminLoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const t = getTranslator();
  return (
    <section className="kv-login">
      <h1>{t.t('login.title')}</h1>
      <p>{t.t('login.lead')}</p>
      {searchParams.error && <p className="kv-error" role="alert">{t.t('login.failed')}</p>}
      <p className="kv-login__cta">
        <Button as="a" href={`${env.publicAdminApiUrl}/auth/sso/start`}>{t.t('login.cta')}</Button>
      </p>
      <p className="kv-muted">{t.t('login.note')}</p>
      {env.devLoginEnabled && (
        <>
          <hr className="kv-login__divider" />
          <p className="kv-muted">{t.t('login.devDivider')}</p>
          <form className="kv-login__cta" method="post" action="/api/dev-login">
            <Button type="submit">{t.t('login.devCta')}</Button>
          </form>
          <p className="kv-muted">{t.t('login.devNote')}</p>
        </>
      )}
    </section>
  );
}
