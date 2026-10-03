// core/secrets/local-secret-writer.ts · dev/local adapter for SecretWriter + SecretReader. An IN-PROCESS store: the plaintext lives in
// this process's memory only (never on disk, never in the database) so the local daily re-verification can read what was connected
// in the same run; after a restart the store is empty and the re-verification records "credential not readable from the vault" —
// honestly, rather than pretending. Dev must never carry real credentials. Selected only outside production; the module factory
// refuses to bind this in prod (fail-closed).
import { randomUUID } from 'node:crypto';
import { SecretWriter } from './secret-writer.port';
import { SecretReader } from './secret-reader.port';

export class LocalSecretWriter implements SecretWriter, SecretReader {
  private readonly store = new Map<string, string>();
  async putTenantSecret(tenantId: string, providerCode: string, plaintext: string, version?: string): Promise<{ secretRef: string }> {
    const secretRef = `local://krishi/${tenantId}/${providerCode}/${version ?? randomUUID()}`;
    this.store.set(secretRef, plaintext);
    return { secretRef };
  }
  async deleteTenantSecret(secretRef: string): Promise<void> { this.store.delete(secretRef); }
  async readTenantSecret(secretRef: string): Promise<string | null> { return this.store.get(secretRef) ?? null; }
}
