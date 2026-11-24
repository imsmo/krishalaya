// apps/web-admin/src/app/login/page.tsx · god-mode sign-in, step 1 of 2: the identity provider.
//
// PC-56 ADMIN-AUTH-1: the link below now goes somewhere. `${adminApiUrl}/v1/auth/sso/start` (admin-api, modules/operator-auth)
// redirects to the organisation's OpenID Connect IdP (Google Workspace by default); its callback verifies the id_token,
// checks the email against the operator bindings (config) and sends the browser to /login/key with a single-use ticket for
// step 2 — the hardware key. This page never accepts a password. All copy via i18n.
//
// Errors are deliberately ONE message: which step failed (unknown email, wrong domain, suspended, expired, replayed) is in
// admin-api's audit log, not on this screen — the screen is not a directory of who is an operator.
//
// DEV-56 Part 3 (unchanged): `env.devLoginEnabled` (false unless a local dev deliberately sets ADMIN_DEV_LOGIN_ENABLED=true)
// additionally renders a clearly-labelled dev-bypass CTA posting to /api/dev-login. See dev-login.controller.ts (Law 8).
import type { Metadata } from 'next';
import { env } from '../../lib/env';
import { getTranslator } from '../../lib/i18n';
import { loginErrorKey, ssoStartUrl } from '../../features/admin-auth/admin-auth';

import { Button, Callout } from '@krishalaya/ui';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('login.title'), robots: { index: false, follow: false } };
}

export default async function AdminLoginPage(props: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = await props.searchParams;
  const t = getTranslator();
  const errKey = loginErrorKey(searchParams.error);
  return (
    <section className="kv-login">
      <h1>{t.t('login.title')}</h1>
      <p>{t.t('login.lead')}</p>
      {errKey === 'login.err.signedOut'
        ? <Callout tone="success" live="polite">{t.t(errKey)}</Callout>
        : errKey ? <p className="kv-error" role="alert">{t.t(errKey)}</p> : null}
      <p className="kv-login__cta">
        <Button as="a" href={ssoStartUrl(env.publicAdminApiUrl)}>{t.t('login.cta')}</Button>
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
