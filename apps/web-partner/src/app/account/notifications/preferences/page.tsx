// apps/web-partner/src/app/account/notifications/preferences/page.tsx · PC-56 PARTNER-6c · W271 (canon `account/notifications/preferences`) — AN
// HONEST PAGE WITH NO CHECKBOX (founder 6c-2, door Q5-A) carrying THE ONE REAL ACT OF PARTNER-6 (founder 6c-3, door Q7-A): the console's
// language, for this browser. Every partner person (no kind gate). The page makes NO partner read (no audit row, no error state); its state
// is the public flag map (lib/console-flag.ts). The chain states are checked FIRST:
//   • `?form=error|review|success|failure` — W2960–W2963, REAL. `?form=review&lang=<code>` names the chosen language in itself, IF the code is
//     one of `@krishalaya/i18n`'s live languages (features/partner6/language.ts — never a literal list); an unknown code prints the error state
//     and sets nothing. The review state's ONE button posts to `chooseLanguageAction` (./actions.ts), which sets `kv_lang` and comes back with
//     `?form=success`, where this page renders in the chosen language (lib/i18n.ts reads the cookie) and names it.
//   • `?act=confirm|success|failure` — W2964–W2966, DECOR (Retry on a page that reads nothing).
// `/notifications/preferences` answers a real 307 here (next.config.js). Certified readless by test/readless.spec.ts.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { getTranslator, getLanguageDef } from '../../../../lib/i18n';
import { partnerConsoleSwitch } from '../../../../lib/console-flag';
import { AccountNotificationPrefsView } from '../../../../components/partner6/AccountNotificationPrefsView';
import { AccountChain6 } from '../../../../components/partner6/AccountChain6';
import { chain6State } from '../../../../features/partner6/refusals';
import { LANGUAGE_CHOICES, PREVIEW_CHOICES, pickLanguage, pickPreviewLanguage } from '../../../../features/partner6/language';
import { chooseLanguageAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner6.notificationPrefs.title'), robots: { index: false, follow: false } };
}

export default async function AccountNotificationPrefsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  const form = chain6State('notification_form', searchParams);
  if (form) {
    const raw = searchParams?.lang;
    const code = Array.isArray(raw) ? raw[0] : raw;
    // PC-56 RTL-1d: a preview code (Arabic) is named too — and its review button posts to the preview act (AccountChain6), never the live one.
    const chosen = form === 'review' ? pickLanguage(code) ?? pickPreviewLanguage(code) : null;
    const state = form === 'review' && !chosen ? 'error' : form;
    return <AccountChain6 t={t} chain="notification_form" state={state} chosen={chosen} current={getLanguageDef()} act={chooseLanguageAction} />;
  }
  const act = chain6State('notification_act', searchParams);
  if (act) return <AccountChain6 t={t} chain="notification_act" state={act} />;
  return <AccountNotificationPrefsView t={t} state={await partnerConsoleSwitch()} current={getLanguageDef()} choices={LANGUAGE_CHOICES} previews={PREVIEW_CHOICES} />;
}
