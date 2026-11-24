// apps/web-admin/src/app/api/auth/[action]/route.ts · PC-56 ADMIN-AUTH-1 — the browser's only door to the sign-in ceremonies.
//
// The key / step-up / security screens' client components post here (same origin — the CSP's connect-src 'self' allows
// nothing else). This handler forwards an ALLOW-LISTED action to admin-api SERVER-TO-SERVER (env.serverAdminApiUrl) and:
//   • on a successful login or step-up, sets the httpOnly `kva_session` cookie ITSELF and answers `{ data: { redirect } }` —
//     the admin token never reaches browser JavaScript;
//   • otherwise answers admin-api's `data` (WebAuthn options, a key id, a one-time enrollment code) or `{ code }` only.
// Ticket actions need a well-formed ticket; session actions need the session cookie (sent as the bearer). Cross-origin
// posts are refused. admin-api re-checks everything — this handler is plumbing, never the authority.
import { NextRequest, NextResponse } from 'next/server';
import { env } from '../../../../lib/env';
import { getAdminToken, setAdminSession } from '../../../../lib/admin-auth';
import {
  browserBody, forwardToAdminApi, isTicket, safeNext, sameOrigin, sessionFrom, type FetchLike, type Forwardable,
} from '../../../../features/admin-auth/admin-auth';

/** URL segment → admin-api action, and whether it rides on a ticket or on the session. */
const ACTIONS: Record<string, { what: Forwardable; auth: 'ticket' | 'session'; mints?: true }> = {
  'key-options': { what: 'keyOptions', auth: 'ticket' },
  'key-enroll': { what: 'keyEnroll', auth: 'ticket' },
  'key-login': { what: 'keyLogin', auth: 'ticket', mints: true },
  'step-up-options': { what: 'stepUpOptions', auth: 'session' },
  'step-up': { what: 'stepUp', auth: 'session', mints: true },
  'add-key-options': { what: 'addKeyOptions', auth: 'session' },
  'add-key': { what: 'addKey', auth: 'session' },
  'issue-code': { what: 'issueCode', auth: 'session' },
};

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: NextRequest, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;
  const spec = ACTIONS[action];
  if (!spec) return json(404, { code: 'NOT_FOUND' });
  if (!sameOrigin(req.headers.get('origin'), req.url)) return json(403, { code: 'CROSS_ORIGIN' });

  let input: Record<string, unknown> = {};
  try { input = (await req.json()) as Record<string, unknown>; } catch { input = {}; }

  let bearer: string | undefined;
  let body: Record<string, unknown> = input;
  if (spec.auth === 'ticket') {
    if (!isTicket(input.ticket)) return json(401, { code: 'AUTH_TICKET_INVALID' });
  } else {
    bearer = getAdminToken();
    if (!bearer) return json(401, { code: 'UNAUTHENTICATED' });
    if (action === 'step-up') body = { response: input.response };   // `next` stays here; admin-api never sees it
  }

  const f = await forwardToAdminApi(globalThis.fetch as unknown as FetchLike, env.serverAdminApiUrl, spec.what, body, {
    bearer, requestId: req.headers.get('x-request-id') ?? undefined,
  });
  if (spec.mints) {
    const session = sessionFrom(f);
    if (!session) return json(f.status >= 400 ? f.status : 502, browserBody(f.status >= 400 ? f : { status: 502, body: {} }));
    setAdminSession(session.token, session.maxAgeSec);
    return json(200, { data: { redirect: action === 'step-up' ? safeNext(input.next) : '/dashboard' } });
  }
  return json(f.status, browserBody(f));
}
