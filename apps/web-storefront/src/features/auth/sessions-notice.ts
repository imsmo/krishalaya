// apps/web-storefront/src/features/auth/sessions-notice.ts · PC-56 STORE-1a · C7 (founder D5) — canon W322 "Verified — new device":
// "Your other session (Redmi, Ahmedabad, active 2h ago) stays signed in — remove it in Account if that isn't you."
// Built from the API's session list: the device FAMILY (android | ios | web | unknown — the API never sends a user-agent string or an IP)
// and how long ago it was last active. The CITY is refused by name (no geolocation provider; founder D5). Pure.

export interface SessionLike { id: string; deviceFamily: 'android' | 'ios' | 'web' | null; current: boolean; lastSeenAt: string; expiresAt: string; revokedAt: string | null }
export interface OtherSessionNotice { familyKey: string; agoKey: string; agoN: number; count: number }

export function familyKey(f: SessionLike['deviceFamily']): string {
  return f === 'android' || f === 'ios' || f === 'web' ? `auth.device.${f}` : 'auth.device.unknown';
}

/** How long ago, as a catalogue key + number: under a minute → now; minutes; hours (< 48); days. */
export function agoOf(iso: string, nowMs: number): { key: string; n: number } {
  const t = Date.parse(iso);
  const sec = Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 1000)) : 0;
  if (sec < 60) return { key: 'auth.ago.now', n: 0 };
  if (sec < 3600) return { key: 'auth.ago.minutes', n: Math.floor(sec / 60) };
  if (sec < 48 * 3600) return { key: 'auth.ago.hours', n: Math.floor(sec / 3600) };
  return { key: 'auth.ago.days', n: Math.floor(sec / 86_400) };
}

/** The most recently active OTHER live session, or null when this is the only one. */
export function otherSessionNotice(list: readonly SessionLike[], nowMs: number): OtherSessionNotice | null {
  const live = list.filter((s) => !s.current && !s.revokedAt && Date.parse(s.expiresAt) > nowMs);
  if (live.length === 0) return null;
  const latest = [...live].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0];
  const ago = agoOf(latest.lastSeenAt, nowMs);
  return { familyKey: familyKey(latest.deviceFamily), agoKey: ago.key, agoN: ago.n, count: live.length };
}
