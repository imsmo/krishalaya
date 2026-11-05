'use server';
// apps/web-partner/src/app/account/notifications/preferences/actions.ts · PC-56 PARTNER-6c · W2960–W2963 — THE LANGUAGE ACT (founder 6c-3, door
// Q7-A), the one REAL act of PARTNER-6. The review state's ONE button posts the chosen code here; the code is checked against
// `@krishalaya/i18n`'s live language list (features/partner6/language.ts — never a literal list), the `kv_lang` cookie is set for this
// browser (path `/`, SameSite=Lax, one year) and the browser goes back to the preferences page with `?form=success`, where the page renders in
// the chosen language. An unknown, empty or injected code → `?form=error` and NOTHING is set; a cookie that could not be written →
// `?form=failure` and nothing changed. It calls NO client and NO API, writes no audit row and touches no person's data (a browser
// preference). It does not call requirePartner(): the cookie concerns only the browser that posts it, and the page that renders the form is
// itself gated. 'use server' files export ONLY async functions.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LANG_COOKIE, languageCookie, languageHref, pickLanguage } from '../../../../features/partner6/language';

export async function chooseLanguageAction(formData: FormData): Promise<void> {
  const raw = formData.get('lang');
  const lang = pickLanguage(raw);
  if (!lang) redirect(languageHref('error'));
  let ok = true;
  try { cookies().set(LANG_COOKIE, lang.code, languageCookie()); } catch { ok = false; }
  redirect(languageHref(ok ? 'success' : 'failure'));
}
