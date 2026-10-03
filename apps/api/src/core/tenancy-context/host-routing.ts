// core/tenancy-context/host-routing.ts · PC-56 TENANT-13d · B3 — WHICH HOSTS ARE THE PLATFORM'S OWN.
//
// Host → tenant resolution (flag `tenant_host_routing`) consults `tenant_domains` for a Host only when that Host is NOT one the platform
// itself answers on: the API's own name, an internal service name, an IP literal, localhost. Getting this wrong would answer 404 to
// every request that reaches the API by its own name, so the rule is pure, listed, and tested:
//   • localhost, *.localhost, *.local, *.internal, *.svc, *.cluster.local, IP literals (v4, bracketed v6);
//   • a first label of api / admin / edge — reserved by 0194 (`reserved_domain_suffixes`), so never any tenant's host;
//   • every host in PLATFORM_HOSTS (comma-separated, AppConfig.tenancy.platformHosts).
const clean = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');

export function hostOnly(raw: string | undefined | null): string {
  const v = String(raw ?? '').trim();
  if (v.startsWith('[')) return v.slice(0, v.indexOf(']') + 1).toLowerCase();
  return clean(v.split(':')[0] ?? '');
}

export function isPlatformHost(host: string, configured: readonly string[]): boolean {
  const h = hostOnly(host);
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.svc')
      || h.endsWith('.cluster.local')) return true;
  if (/^[0-9.]+$/.test(h) || h.startsWith('[')) return true;
  const first = h.split('.')[0];
  if (first === 'api' || first === 'admin' || first === 'edge') return true;
  return configured.map(clean).includes(h);
}
