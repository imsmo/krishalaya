// apps/web-gov/src/app/login/page.tsx · PC-56 GOV-1a — W355 (`/login`) and the login chain (W3229–W3232 as `?act=` states): sign-in TO A
// GOVERNMENT AUTHORITY (GOV-1 Q2-A + Q5-A). The steps and their markup live in components/gov1/LoginViews.tsx (render-tested); this page reads
// the step and the chain state from the query, the MASKED pending phone, the chooser's authorities, the set-up key and the recovery codes from
// their httpOnly cookies (set by ./actions.ts — never the URL), and the platform switch `gov_console` from the public flag map: OFF prints the
// switched-off sentence instead of a form that would 404. The success state names the authority from `GET /v1/gov/me`. noindex.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getLang, getTranslator } from '../../lib/i18n';
import { anonClient } from '../../lib/api-client';
import { govGate } from '../../lib/session';
import { LoginView } from '../../components/gov1/LoginViews';
import { chain1State } from '../../features/gov1/refusals';
import { loginErrorCode, loginStep } from '../../features/gov1/login';
import { requestOtpAction, verifyOtpAction, chooseAction, twoFactorAction, enrolAction, confirmEnrolAction, startOverAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('login.title'), robots: { index: false, follow: false } };
}

async function consoleSwitch(): Promise<'on' | 'off' | 'unknown'> {
  try {
    const r = await anonClient().request<Record<string, boolean>>('GET', 'config/flags', { anonymous: true });
    const v = r.data?.gov_console;
    return v === true ? 'on' : v === false ? 'off' : 'unknown';
  } catch { return 'unknown'; }
}
/** `••••••318` — six bullets and the last 3 digits (GOV-0's mask). */
function maskPhone(raw: string | undefined): string | null {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  return digits.length < 4 ? null : `${'•'.repeat(6)}${digits.slice(-3)}`;
}
function json<T>(name: string, fallback: T): T {
  try { return JSON.parse(cookies().get(name)?.value ?? '') as T; } catch { return fallback; }
}
const num = (v: string | undefined) => (v !== undefined && /^\d{1,4}$/.test(v) ? Number(v) : null);

export default async function LoginPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const t = getTranslator();
  const act = chain1State('login_form', searchParams) as 'form-error' | 'review' | 'success' | 'failure' | null;
  const off = !act && (await consoleSwitch()) === 'off';
  let signedInTo: string | null = null;
  if (act === 'success') {
    const g = await govGate();
    signedInTo = g.kind === 'gov' ? g.me.authority?.name ?? null : null;
  }
  return (
    <LoginView
      t={t}
      step={off ? 'off' : loginStep(searchParams.step)}
      act={act}
      error={loginErrorCode(searchParams.error)}
      left={num(searchParams.left)}
      wait={num(searchParams.wait)}
      phoneMasked={maskPhone(cookies().get('kvg_pending_phone')?.value)}
      choices={json<{ authorities?: Array<{ id: string; name: string }> }>('kvg_choice', {}).authorities ?? []}
      enrolKey={json<{ secret: string; otpauthUri: string } | null>('kvg_enrol_key', null)}
      recoveryCodes={json<string[] | null>('kvg_recovery', null)}
      signedInTo={signedInTo}
      lang={getLang()}
      actions={{ requestOtp: requestOtpAction, verifyOtp: verifyOtpAction, choose: chooseAction, twoFactor: twoFactorAction, enrol: enrolAction, confirmEnrol: confirmEnrolAction, startOver: startOverAction }}
    />
  );
}
