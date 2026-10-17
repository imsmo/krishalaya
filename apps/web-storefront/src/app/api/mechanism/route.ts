// apps/web-storefront/src/app/api/mechanism/route.ts · DEV-19. The theme/senior-mode preference switcher's
// no-JS endpoint — mirrors `apps/web-tenant/src/app/api/mechanism/route.ts` exactly (referer-redirect, no
// client JS, no token, no PII; see that file's own header comment for the full design rationale).
// PC-56 STORE-5a · D4 (founder Q17) — + High contrast (`contrast` on/off → `kvs_contrast`) and Calm motion (`motion` calm/off → `kvs_motion`),
// per device. A post carrying `chain=a11y` (the accessibility page's switches — the W3074–W3076 save chain) is answered with its outcome on the
// way back: `?a11y=saved&mode=<mode>` (W3075), or — the form could not be read, or a value is not one the mode takes — NO cookie is set
// (nothing half-switched) and `?a11y=err&want=<mode>:<value>` (W3076: Retry re-posts the same values). The decision is pure
// (features/store5a/accessibility.ts `mechanismDecision`); posts without the chain keep the old behaviour (4c's senior toggle, the theme).
import { NextRequest, NextResponse } from 'next/server';
import { THEME_PREFERENCES } from '@krishalaya/ui';
import { mechanismDecision, a11yReturn } from '../../../features/store5a/accessibility';

const ONE_YEAR = 60 * 60 * 24 * 365;

function sameOriginRedirectTarget(req: NextRequest): string {
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.origin === req.nextUrl.origin) return url.pathname + url.search;
    } catch {
      // fall through to default below
    }
  }
  return '/';
}

export async function POST(req: NextRequest) {
  let form: FormData | null = null;
  try { form = await req.formData(); } catch { form = null; }
  const d = mechanismDecision(form, THEME_PREFERENCES as readonly string[]);
  const res = NextResponse.redirect(new URL(a11yReturn(sameOriginRedirectTarget(req), d), req.url), 303);
  for (const c of d.set) {
    res.cookies.set(c.cookie, c.value, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ONE_YEAR });
  }
  return res;
}
