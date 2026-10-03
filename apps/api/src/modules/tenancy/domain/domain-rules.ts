// modules/tenancy/domain/domain-rules.ts · PC-56 TENANT-13d · W192 DOMAINS — THE PURE RULES.
//
// Founder decision 2026-10-03: DOMAIN BY PLAN (custom_domain); CNAME + TXT PROOF; PLATFORM EDGE; HOST ROUTING; ACME LATER.
//
//   • A custom domain is a CLAIM: the tenant adds a CNAME <domain> → <platform edge> and a TXT `_krishalaya-verify.<domain>` = its
//     token. The verifier checks BOTH; it never marks a domain verified on anything less ("no fake verified").
//   • TLS: certificate issuance (ACME) is not built — a custom domain's tls_status stays `pending` and says why, in words. The included
//     subdomain's TLS is `issued` only when the platform wildcard certificate is configured.
//   • The reserved-domain rule is ONE implementation, in the database (`domain_reserved_problem`, 0194); this file only normalises.
import { randomBytes } from 'node:crypto';

// labels of 1–63 chars; total ≤ 253; no leading/trailing hyphen per label; at least two labels (anchored — no backtracking blow-up)
const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const VERIFY_TXT_LABEL = '_krishalaya-verify';
export const CLAIM_TTL_DAYS = 7;
export const RECHECK_MIN_INTERVAL_MS = 60_000;
export const VERIFY_INTERVAL_MS = 5 * 60_000;
export const DOMAIN_REASON_MIN = 20;
export const DOMAIN_REASON_MAX = 500;
export const TLS_NOT_BUILT_NOTE = 'certificate issuance not yet built (own infrastructure wave)';
export const WILDCARD_NOT_READY_NOTE = 'platform wildcard certificate not yet configured';

export const TLS_STATUSES = ['pending', 'issued', 'failed'] as const;
export type TlsStatus = (typeof TLS_STATUSES)[number];
export const VERIFICATION_STATUSES = ['pending', 'verified', 'failed', 'expired'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type DomainKind = 'included' | 'custom';

/** Lower-case, trim, drop ONE trailing dot; null when it is not a hostname this platform can route. */
export function normaliseHost(raw: unknown): string | null {
  const v = String(raw ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(v)) return null;
  if (/^[0-9.]+$/.test(v)) return null;
  return v;
}

/** 32 lower-case hex characters (16 random bytes) — the TXT proof. */
export function newVerificationToken(): string { return randomBytes(16).toString('hex'); }

/** The two DNS records the tenant adds — printed on the review, the success screen and the domain row (canon step 1). */
export function dnsRecords(domain: string, edgeHostname: string, token: string | null): Array<{ type: 'CNAME' | 'TXT'; name: string; value: string }> {
  const out: Array<{ type: 'CNAME' | 'TXT'; name: string; value: string }> = [{ type: 'CNAME', name: domain, value: edgeHostname }];
  if (token) out.push({ type: 'TXT', name: `${VERIFY_TXT_LABEL}.${domain}`, value: token });
  return out;
}

/** What one DNS check saw. `error` is set when the lookup itself failed (NXDOMAIN, timeout …). */
export interface DnsObservation {
  cname: { values: string[]; error: string | null };
  txt: { values: string[]; error: string | null };
}
export type VerifyOutcome = { verified: true } | { verified: false; error: string };

const clean = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');

/**
 * The verifier's judgement — pure. Verified ONLY when the CNAME points at the edge AND the TXT carries the token. Otherwise the reason,
 * in words a tenant's IT person can act on (canon: "DNS instructions are safe to share with your IT person").
 */
export function judgeDns(domain: string, edge: string, token: string, seen: DnsObservation): VerifyOutcome {
  const problems: string[] = [];
  const cnames = seen.cname.values.map(clean);
  if (seen.cname.error) problems.push(`CNAME for ${domain}: ${seen.cname.error}`);
  else if (cnames.length === 0) problems.push(`no CNAME record found for ${domain}`);
  else if (!cnames.includes(clean(edge))) problems.push(`CNAME for ${domain} points to ${cnames.join(', ')}, not ${clean(edge)}`);
  const txtName = `${VERIFY_TXT_LABEL}.${domain}`;
  const txts = seen.txt.values.map((t) => t.trim());
  if (seen.txt.error) problems.push(`TXT for ${txtName}: ${seen.txt.error}`);
  else if (txts.length === 0) problems.push(`no TXT record found at ${txtName}`);
  else if (!txts.includes(token)) problems.push(`TXT at ${txtName} does not contain the verification token`);
  return problems.length === 0 ? { verified: true } : { verified: false, error: problems.join('; ') };
}

/** A DNS error code from node's resolver, as words. */
export function dnsErrorWords(code: string | undefined): string {
  switch (code) {
    case 'ENOTFOUND': case 'ENODATA': return 'no such record (the name does not exist yet)';
    case 'ETIMEOUT': return 'the DNS lookup timed out';
    case 'ESERVFAIL': return 'the domain\'s DNS servers returned an error';
    case 'EREFUSED': return 'the DNS server refused the lookup';
    case 'ECONNREFUSED': return 'the DNS resolver could not be reached';
    default: return `the DNS lookup failed (${code ?? 'unknown'})`;
  }
}

/** Words for each verification status, used in the API's `statusWords` (the console prints its own i18n; logs and audits use these). */
export function claimExpiresAt(createdAt: Date): Date { return new Date(createdAt.getTime() + CLAIM_TTL_DAYS * 86_400_000); }

/** Re-exported: the platform-host rule lives in core (the middleware needs it before any module runs). */
export { isPlatformHost } from '../../../core/tenancy-context/host-routing';
