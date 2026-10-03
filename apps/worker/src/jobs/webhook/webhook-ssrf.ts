// webhook-ssrf.ts · THE WEBHOOK TARGET GUARD — PC-56 TENANT-13a (F-3). ONE function, two callers: registration (the tenant API's
// review and register) and EVERY send (the delivery worker, at send time, after resolving the host). This file is byte-identical
// in apps/api/src/modules/tenant-webhooks/domain/webhook-ssrf.ts and apps/worker/src/jobs/webhook/webhook-ssrf.ts; the parity
// spec (tenant-webhooks/__tests__/tenant13a-worker-parity.spec.ts) fails on any drift, so the two can never disagree about what
// "public" means.
//
// WHAT IS REFUSED, AND WHY EACH LINE EXISTS:
//   • anything but https, credentials in the URL, any port but 443;
//   • names that are internal by construction — localhost (and `localhost.` — a trailing dot is stripped BEFORE any name test, the
//     survey's bypass), *.localhost, *.local, *.internal, *.home.arpa, metadata, metadata.google.internal, and every single-label
//     name (it resolves through the platform's own search domains, i.e. inside the VPC);
//   • every address that is not public unicast — IPv4 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24,
//     192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4; IPv6 is an ALLOW-list: only 2000::/3 global unicast, minus
//     2001::/23, 2001:db8::/32, 2002::/16 (6to4 — judged by its embedded IPv4) and with ::ffff:0:0/96 (mapped) and 64:ff9b::/96
//     (NAT64) judged by the IPv4 they embed. ::, ::1, ::/96, 64:ff9b:1::/48, 100::/64, fc00::/7, fe80::/10, fec0::/10 and ff00::/8
//     all fall outside the allow-list. `[::ffff:169.254.169.254]` (which WHATWG prints as `[::ffff:a9fe:a9fe]`), `[::ffff:127.0.0.1]`,
//     `[fec0::1]` and `[64:ff9b::a9fe:a9fe]` — the survey's literal bypasses — are each refused here by arithmetic, not by prefix text;
//   • a NAME that resolves to any such address (`169.254.169.254.nip.io`): `vetWebhookTarget` resolves EVERY address (dns.lookup
//     all) and refuses if ANY is not public, then returns the one vetted address the caller must connect to (pinning — the
//     connection never re-resolves, so a rebinding answer after the check cannot be reached).
//
// Pure apart from the injected resolver; no logging, no I/O of its own.
import { isIP } from 'node:net';

export type GuardReason =
  | 'invalid_url' | 'not_https' | 'has_credentials' | 'bad_port' | 'no_host' | 'blocked_host' | 'single_label_host'
  | 'private_address' | 'unresolvable' | 'no_address';

export interface ResolvedAddress { address: string; family: 4 | 6 }
/** Resolve EVERY address of a host (the worker passes dns.lookup with { all: true, verbatim: true }). */
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

export type SyntaxVerdict =
  | { ok: true; host: string; port: 443; path: string; literal: ResolvedAddress | null }
  | { ok: false; reason: GuardReason; host?: string; address?: string };

export type TargetVerdict =
  | { ok: true; host: string; port: 443; path: string; addresses: ResolvedAddress[]; pinned: ResolvedAddress }
  | { ok: false; reason: GuardReason; host?: string; address?: string };

const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* IPv4                                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}

/** True when an IPv4 address (as four octets) is anything but public unicast. */
export function isNonPublicIpv4(o: readonly number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true;                                 // 0/8 "this network"
  if (a === 10) return true;                                // 10/8 private
  if (a === 100 && b >= 64 && b <= 127) return true;        // 100.64/10 CGNAT
  if (a === 127) return true;                               // 127/8 loopback
  if (a === 169 && b === 254) return true;                  // 169.254/16 link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;         // 172.16/12 private
  if (a === 192 && b === 0 && c === 0) return true;         // 192.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true;         // 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 168) return true;                  // 192.168/16 private
  if (a === 198 && (b === 18 || b === 19)) return true;     // 198.18/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true;      // 198.51.100/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;       // 203.0.113/24 TEST-NET-3
  if (a >= 224 && a <= 239) return true;                    // 224/4 multicast
  if (a >= 240) return true;                                // 240/4 reserved + 255.255.255.255 broadcast
  return false;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* IPv6                                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** Expand an IPv6 literal (brackets, zone id and an embedded dotted IPv4 tail allowed) to eight 16-bit groups, or null. */
export function parseIpv6(raw: string): number[] | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (isIP(s) !== 6) return null;
  // an embedded dotted IPv4 tail (`::ffff:127.0.0.1`) becomes its two hex groups first, so one expansion handles every form
  const lastColon = s.lastIndexOf(':');
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIpv4(maybeV4);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  let groups: string[];
  if (parts.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

const v4Of = (hi: number, lo: number): number[] => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];

/** True when an IPv6 address (eight groups) is anything but public unicast — an allow-list over 2000::/3. */
export function isNonPublicIpv6(g: readonly number[]): boolean {
  // ::ffff:0:0/96 — IPv4-mapped: judged as the IPv4 it embeds
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return isNonPublicIpv4(v4Of(g[6], g[7]));
  // 64:ff9b::/96 — the well-known NAT64 prefix: judged as the IPv4 it embeds
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return isNonPublicIpv4(v4Of(g[6], g[7]));
  // everything else must be global unicast 2000::/3 …
  if ((g[0] & 0xe000) !== 0x2000) return true;              // ::/128, ::1, ::/96, 64:ff9b:1::/48, 100::/64, fc00::/7, fe80::/10, fec0::/10, ff00::/8 …
  // … minus the reserved sub-ranges inside it
  if (g[0] === 0x2001 && g[1] < 0x0200) return true;        // 2001::/23 IETF protocol assignments (incl. Teredo 2001::/32)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;      // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return isNonPublicIpv4(v4Of(g[1], g[2])); // 2002::/16 6to4 — judged as its embedded IPv4
  return false;
}

/** Classify any address string. Unparseable is NOT public (fail closed). */
export function isNonPublicAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return isNonPublicIpv4(v4);
  const v6 = parseIpv6(address);
  if (v6) return isNonPublicIpv6(v6);
  return true;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The URL                                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** The syntactic half: scheme, credentials, port, the host's name or literal. No DNS. */
export function checkWebhookUrl(raw: string): SyntaxVerdict {
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { return { ok: false, reason: 'invalid_url' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (u.username || u.password) return { ok: false, reason: 'has_credentials' };
  if (u.port !== '' && u.port !== '443') return { ok: false, reason: 'bad_port' };
  let host = u.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');                          // `localhost.` → `localhost` BEFORE any name test
  if (!host) return { ok: false, reason: 'no_host' };
  const path = `${u.pathname || '/'}${u.search || ''}`;
  if (isIP(host) === 4) {
    const o = parseIpv4(host);
    if (!o || isNonPublicIpv4(o)) return { ok: false, reason: 'private_address', host, address: host };
    return { ok: true, host, port: 443, path, literal: { address: host, family: 4 } };
  }
  if (isIP(host) === 6) {
    const g = parseIpv6(host);
    if (!g || isNonPublicIpv6(g)) return { ok: false, reason: 'private_address', host, address: host };
    return { ok: true, host, port: 443, path, literal: { address: host, family: 6 } };
  }
  if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: 'blocked_host', host };
  if (!host.includes('.')) return { ok: false, reason: 'single_label_host', host };
  return { ok: true, host, port: 443, path, literal: null };
}

/** The full verdict: syntax, then EVERY resolved address public, then the one address to pin the connection to. */
export async function vetWebhookTarget(raw: string, resolve: Resolver): Promise<TargetVerdict> {
  const s = checkWebhookUrl(raw);
  if (!s.ok) return s;
  if (s.literal) return { ok: true, host: s.host, port: 443, path: s.path, addresses: [s.literal], pinned: s.literal };
  let addresses: ResolvedAddress[];
  try { addresses = await resolve(s.host); } catch { return { ok: false, reason: 'unresolvable', host: s.host }; }
  if (!addresses || addresses.length === 0) return { ok: false, reason: 'no_address', host: s.host };
  for (const a of addresses) {
    if (isNonPublicAddress(a.address)) return { ok: false, reason: 'private_address', host: s.host, address: a.address };
  }
  return { ok: true, host: s.host, port: 443, path: s.path, addresses, pinned: addresses[0] };
}
