// apps/mobile/src/core/offline/owner.ts · PC-56 HOTFIX-8 · D2 — WHO owns this device's queued writes right now. Pure (no React Native, no
// storage), unit-tested in core/__tests__/owner-scope.spec.ts.
//
// The cache scope (core/offline/scope.ts) used to be set only by `loadProfile` (GET /users/me) — so after an app restart with no signal, the
// scope stayed 'anon' until the network returned. With the queue now refusing an owner-less write, that would have refused exactly the
// farmer the queue exists for. So the scope is ALSO set from the session's own access token at sign-in and at boot restore: its `sub` is
// the user id (the same id /users/me answers) and its `tid` the organisation. Read, never verified — the token came from our API or the
// device's secure store, and this decides only whose queue and cache a write belongs to; the API still authorises every call.

export interface SessionOwner { userId: string; tenantId: string | null }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url → UTF-8 text, with no Buffer and no atob (Hermes-safe). Null on anything malformed. */
export function decodeBase64Url(seg: string): string | null {
  const s = seg.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buf = 0; let bits = 0;
  for (const ch of s) {
    buf = (buf << 6) | B64.indexOf(ch); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
  }
  try { return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join('')); }
  catch { return null; }
}

/** The owner a session's access token names: `sub` (the user id) and `tid` (the organisation), or null for anything malformed. */
export function ownerOfAccessToken(accessToken: string | null | undefined): SessionOwner | null {
  const seg = String(accessToken ?? '').split('.')[1];
  if (!seg) return null;
  const json = decodeBase64Url(seg);
  if (!json) return null;
  try {
    const c = JSON.parse(json) as { sub?: unknown; tid?: unknown };
    if (typeof c.sub !== 'string' || c.sub.length === 0 || c.sub.length > 64 || c.sub === 'anon') return null;
    return { userId: c.sub, tenantId: typeof c.tid === 'string' && c.tid.length > 0 ? c.tid : null };
  } catch { return null; }
}
