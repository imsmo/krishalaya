// apps/web-storefront/src/app/api/lang/route.ts · the locale switcher's no-JS endpoint. A plain <form method=post>
// in the header posts `lang` (+ a `from` return path); we validate the language against the supported set
// (fail-closed to the default — never trust the client value), persist it in the `kv_lang` cookie, and 303 back
// to the page the user was on. No token, no PII; a same-origin `from` only (open-redirect guard).
//
// DEV-26/Q16: the redirect target now ALSO carries `?lang=<code>` (via `withUrlLang`) — so the act of switching
// language produces a genuinely locale-bearing, shareable/bookmarkable URL, not just a cookie side-effect. This
// is purely additive to the existing cookie mechanism (unchanged) — `middleware.ts` also honors this same
// `?lang=` param for a fresh visitor with no cookie yet, per Q16's ratified URL/locale scheme.
//
// PC-56 STORE-4c · C4 (founder D3 — ONE language): when the person is SIGNED IN, switching the site's language ALSO sets the ACCOUNT language
// (`PATCH users/me { languageCode }` — what their notices are written in; audited `user.profile_updated`). BEST EFFORT: the cookie is set
// either way and the switch never waits on, or fails with, the API — a failed PATCH is logged, and the preferences page prints the account
// language beside the site's so the mismatch is visible. Anonymous visitors keep the cookie only (features/store4c/preferences.ts
// `langRouteDecision`, unit-tested).
import { NextResponse } from 'next/server';
import { isSupported, resolveLanguage } from '@krishalaya/i18n';
import { LANG_COOKIE } from '../../../lib/i18n';
import { withUrlLang } from '../../../lib/locale-url';
import { getSessionToken } from '../../../lib/auth';
import { serverClient } from '../../../lib/api-client';
import { langRouteDecision } from '../../../features/store4c/preferences';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const raw = String(form.get('lang') ?? '');
  const lang = isSupported(raw) ? resolveLanguage(raw).code : 'en';   // fail-closed to default
  const fromRaw = String(form.get('from') ?? '/');
  const from = fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : '/';   // same-origin only (no open redirect)

  const decision = langRouteDecision({ lang, signedIn: !!getSessionToken() });
  if (decision.patchAccount) {
    try { await serverClient().users.updateMe({ languageCode: lang }); }
    catch (e) { console.warn(`[lang] the account language was not updated (the site switched anyway): ${e instanceof Error ? e.message : String(e)}`); }
  }
  const res = NextResponse.redirect(new URL(withUrlLang(from, lang), req.url), 303);
  res.cookies.set(LANG_COOKIE, decision.cookie, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ONE_YEAR });
  return res;
}
