// modules/tenancy/infra/domain-dns.port.ts · PC-56 TENANT-13d · B2 — THE DNS SEAM AND THE ACME SEAM.
//
// DOMAIN_DNS — the verifier's only way to see DNS. The production binding is node's `dns.promises.Resolver`, PINNED to the platform
// resolvers (`platform.dns_resolvers`, never the pod's own resolver, which inside a VPC may answer split-horizon), with a timeout. The
// integration spec binds a fake that answers exactly what each test sets up — "a port with a fake in tests".
//
// ACME_PORT — certificate issuance is REFUSED BY NAME in this wave ("ACME later", founder decision). The interface exists so the
// infrastructure wave that builds issuance has its seam; the only implementation, `NotConfiguredAcme`, never claims a certificate.
import { Resolver } from 'node:dns/promises';
import { dnsErrorWords, DnsObservation, TLS_NOT_BUILT_NOTE, VERIFY_TXT_LABEL } from '../domain/domain-rules';

export const DOMAIN_DNS = Symbol('DOMAIN_DNS');
export interface DomainDnsPort {
  /** One observation of a claim's two records, through the given resolvers. Never throws — a failed lookup is an observation. */
  observe(domain: string, resolvers: readonly string[]): Promise<DnsObservation>;
}

const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;

export class NodeDomainDns implements DomainDnsPort {
  constructor(private readonly timeoutMs = 4000) {}
  async observe(domain: string, resolvers: readonly string[]): Promise<DnsObservation> {
    const r = new Resolver({ timeout: this.timeoutMs, tries: 2 });
    const servers = resolvers.filter((s) => IP_RE.test(s));
    if (servers.length) r.setServers(servers);
    const [cname, txt] = await Promise.all([
      r.resolveCname(domain).then((v) => ({ values: v, error: null }), (e: { code?: string }) => ({ values: [] as string[], error: dnsErrorWords(e?.code) })),
      r.resolveTxt(`${VERIFY_TXT_LABEL}.${domain}`).then((v) => ({ values: v.map((chunks) => chunks.join('')), error: null }),
        (e: { code?: string }) => ({ values: [] as string[], error: dnsErrorWords(e?.code) })),
    ]);
    return { cname, txt };
  }
}

export const ACME_PORT = Symbol('ACME_PORT');
export type AcmeResult = { issued: true; expiresAt: string } | { issued: false; reason: 'not_built'; note: string };
export interface AcmePort {
  /** Request a certificate for a VERIFIED custom domain at the platform edge. */
  requestCertificate(domain: string): Promise<AcmeResult>;
}
/** The only implementation in this wave: issuance is not built, and it says so — it never claims a certificate. */
export class NotConfiguredAcme implements AcmePort {
  async requestCertificate(_domain: string): Promise<AcmeResult> {
    return { issued: false, reason: 'not_built', note: TLS_NOT_BUILT_NOTE };
  }
}
