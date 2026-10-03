// core/secrets/secret-writer.port.ts · PORT for writing a tenant's third-party credential into a managed secret
// store and getting back an opaque reference (Law: never store raw provider secrets in our DB — only a vault ref).
// Real adapter = AWS Secrets Manager (prod). Dev/local adapter = an in-process store (dev must never use real credentials).
// The dev path must NEVER be active in production — the module factory fails closed at boot if prod isn't bound to the real adapter.
//
// PC-56 TENANT-13c: `version` makes every credential its OWN secret (`<prefix>/<tenant>/<provider>/<version>`), so a rotation writes the
// new credential beside the old one and the old one is retired only after the new one is verified and committed — zero downtime, and
// a retire can never delete the credential that replaced it (the pre-13c writer overwrote one name in place).
export const SECRET_WRITER = Symbol('SECRET_WRITER');

export interface SecretWriter {
  /** Store `plaintext` under a tenant+provider(+version) scoped name; return the opaque ref persisted on the row. */
  putTenantSecret(tenantId: string, providerCode: string, plaintext: string, version?: string): Promise<{ secretRef: string }>;
  /** Best-effort delete on disconnect / after a rotation (idempotent; a missing secret is not an error). */
  deleteTenantSecret(secretRef: string): Promise<void>;
}
