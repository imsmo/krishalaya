// apps/web-partner/src/app/login/page.tsx · PC-56 PARTNER-0 · founder D8 — sign-in TO THE PARTNER. The steps and their markup live in
// components/LoginSteps.tsx (render-tested); this page reads the step from the query, the MASKED pending phone and the chooser's partners from
// their httpOnly cookies (set by ./actions.ts — never the URL, F-9), and the platform switch `partner_console` from GET /v1/config/flags: OFF
// prints the switched-off sentence instead of a form that would 404. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslator } from '../../lib/i18n';
import { partnerConsoleSwitch } from '../../lib/console-flag';
import { LoginSteps, type LoginStep } from '../../components/LoginSteps';
import { maskPhone } from '../../features/partner/mask';
import { requestOtpAction, verifyOtpAction, chooseAction, twoFactorAction, startOverAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('login.title'), robots: { index: false, follow: false } };
}

const STEPS: readonly LoginStep[] = ['phone', 'verify', 'choose', '2fa'];

export default async function LoginPage({ searchParams }: { searchParams: { step?: string; error?: string } }) {
  const t = getTranslator();
  const off = (await partnerConsoleSwitch()) === 'off';
  const asked = (STEPS as readonly string[]).includes(searchParams.step ?? '') ? (searchParams.step as LoginStep) : 'phone';
  let choices: Array<{ id: string; name: string }> = [];
  try { choices = (JSON.parse(cookies().get('kvp_choice')?.value ?? '{}') as { partners?: Array<{ id: string; name: string }> }).partners ?? []; } catch { choices = []; }
  return (
    <LoginSteps
      t={t}
      step={off ? 'off' : asked}
      phoneMasked={maskPhone(cookies().get('kvp_pending_phone')?.value)}
      choices={choices}
      error={searchParams.error ?? null}
      actions={{ requestOtp: requestOtpAction, verifyOtp: verifyOtpAction, choose: chooseAction, twoFactor: twoFactorAction, startOver: startOverAction }}
    />
  );
}
