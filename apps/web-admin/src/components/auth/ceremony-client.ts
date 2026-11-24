// apps/web-admin/src/components/auth/ceremony-client.ts · PC-56 ADMIN-AUTH-1 — the browser side of the WebAuthn ceremonies.
//
// @simplewebauthn/browser (pinned EXACT at 13.3.0) does the one thing a browser library must: convert the JSON options into the
// ArrayBuffers navigator.credentials wants, and the credential back into JSON. Everything goes to OUR route handler
// (/api/auth/<action>), which forwards it to admin-api; nothing here talks to admin-api or sees a token.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ceremonyErrorCode } from '../../features/admin-auth/admin-auth';

export type ActionResult = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; code: string };

export async function postAction(action: string, body: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(`/api/auth/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), credentials: 'same-origin', cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; code?: string };
    return res.ok ? { ok: true, data: json.data ?? {} } : { ok: false, status: res.status, code: json.code ?? 'AUTH_REFUSED' };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
}

/** Run navigator.credentials.get(); folds browser errors to CEREMONY_CANCELLED / UNSUPPORTED / GENERIC. */
export async function assertWithKey(options: unknown): Promise<{ ok: true; response: unknown } | { ok: false; code: string }> {
  try { return { ok: true, response: await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'] }) }; }
  catch (e) { return { ok: false, code: ceremonyErrorCode(e) }; }
}

/** Run navigator.credentials.create(). */
export async function registerKey(options: unknown): Promise<{ ok: true; response: unknown } | { ok: false; code: string }> {
  try { return { ok: true, response: await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'] }) }; }
  catch (e) { return { ok: false, code: ceremonyErrorCode(e) }; }
}
