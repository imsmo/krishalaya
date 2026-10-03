// PC-56 TENANT-13c: NO LONGER THE WIRE SHAPE. Its `connected` flag claimed a connection nothing read; the service now returns the honest
// view (status verified / verify_failed / disconnected / unverified, masked ref, consumers). Kept (nothing deleted) with its spec, which
// still pins that a ref never serialises.
// modules/tenant-integrations/domain/tenant-integration.entity.ts · a tenant's connection to a third-party
// provider (0002 tenant_integrations). The raw credential is NEVER stored here — only the opaque vault `secretRef`
// (AWS Secrets Manager ARN). `serialize()` is the wire shape: it exposes `connected` + non-secret `config` but
// NEVER the secretRef (defence against accidental leakage). config is non-secret settings only.
export interface TenantIntegrationProps {
  id: string; tenantId: string; providerCode: string; secretRef: string;
  config: Record<string, unknown>; isActive: boolean;
  providerName?: string | null; category?: string | null; createdAt?: string | null;
}

export class TenantIntegration {
  constructor(private readonly props: TenantIntegrationProps) {}
  get id() { return this.props.id; }
  toProps(): TenantIntegrationProps { return this.props; }

  /** Wire shape — secretRef intentionally excluded; `connected` signals a credential exists. */
  serialize() {
    const p = this.props;
    return {
      id: p.id,
      providerCode: p.providerCode,
      providerName: p.providerName ?? null,
      category: p.category ?? null,
      config: p.config ?? {},
      connected: Boolean(p.secretRef) && p.isActive,
      isActive: p.isActive,
      createdAt: p.createdAt ?? null,
    };
  }
}
