// apps/web-ops/src/app/api/lang/route.ts · the locale switcher's no-JS endpoint. A plain <form method=post>
// posts `lang` (+ a `from` return path); we validate the language against the supported set (fail-closed to the
// default — never trust the client value), persist it in the `kvo_lang` cookie, and 303 back to where the user
// was. No token, no PII; a same-origin `from` only (open-redirect guard).
//
// DEV-26/Q16: the redirect target now ALSO carries `?lang=<code>` (via `withUrlLang`) — a language switch
// produces a genuinely locale-bearing, shareable/bookmarkable URL, not just a cookie side-effect; additive to
// the existing cookie mechanism. `middleware.ts` honors this same param for a fresh visitor with no cookie yet.
import { NextRequest, NextResponse } from 'next/server';
import { isSupported, resolveLanguage } from '@krishalaya/i18n';
import { LANG_COOKIE } from '../../../lib/i18n';
import { withUrlLang } from '../../../lib/locale-url';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const raw = String(form.get('lang') ?? '');
  const lang = isSupported(raw) ? resolveLanguage(raw).code : 'en'; // fail-closed to default
  const fromRaw = String(form.get('from') ?? '/');
  const from = fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : '/'; // same-origin only
  const res = NextResponse.redirect(new URL(withUrlLang(from, lang), req.url), 303);
  res.cookies.set(LANG_COOKIE, lang, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ONE_YEAR });
  return res;
}
