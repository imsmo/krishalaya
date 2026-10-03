// core/secrets/aws-secret-writer.ts · production adapter for SecretWriter, backed by AWS Secrets Manager. Every
// call is wrapped in core/resilience (timeout + retry + breaker). The AWS SDK is loaded lazily so the package is a
// soft dependency (only required when this adapter is actually bound — i.e. production); typecheck never needs it.
// The plaintext provider credential is written to SM under a tenant+provider scoped name; we persist ONLY the ARN.
import { ResilienceService } from '../resilience/resilience.service';
import { SecretWriter } from './secret-writer.port';
import { SecretReader } from './secret-reader.port';

export interface AwsSecretWriterOptions { region: string; prefix: string; }

export class AwsSecretWriter implements SecretWriter, SecretReader {
  private client: any;
  constructor(private readonly opts: AwsSecretWriterOptions, private readonly resilience: ResilienceService) {}

  private async sm(): Promise<any> {
    if (this.client) return this.client;
    // Lazy, soft dependency — present in the prod image, never imported in dev/test/typecheck paths.
    const mod: any = await import('@aws-sdk/client-secrets-manager' as any).catch(() => {
      throw new Error('AWS Secrets Manager SDK not installed; cannot manage tenant integration credentials');
    });
    this.client = new mod.SecretsManagerClient({ region: this.opts.region });
    this._mod = mod;
    return this.client;
  }
  private _mod: any;

  private name(tenantId: string, providerCode: string, version?: string): string {
    return version ? `${this.opts.prefix}/${tenantId}/${providerCode}/${version}` : `${this.opts.prefix}/${tenantId}/${providerCode}`;
  }

  async putTenantSecret(tenantId: string, providerCode: string, plaintext: string, version?: string): Promise<{ secretRef: string }> {
    const client = await this.sm();
    const Name = this.name(tenantId, providerCode, version);
    return this.resilience.run('aws.secretsmanager.put', async () => {
      // Upsert: try create, fall back to put-value if it already exists.
      try {
        const out = await client.send(new this._mod.CreateSecretCommand({ Name, SecretString: plaintext }));
        return { secretRef: out.ARN as string };
      } catch (e: any) {
        if (e?.name !== 'ResourceExistsException') throw e;
        const out = await client.send(new this._mod.PutSecretValueCommand({ SecretId: Name, SecretString: plaintext }));
        return { secretRef: out.ARN as string };
      }
    }, { retries: 2 });
  }

  async deleteTenantSecret(secretRef: string): Promise<void> {
    const client = await this.sm();
    await this.resilience.run('aws.secretsmanager.delete', async () => {
      await client.send(new this._mod.DeleteSecretCommand({ SecretId: secretRef, ForceDeleteWithoutRecovery: false }));
    }, { retries: 1, fallback: () => undefined }).catch(() => undefined);
  }

  /** PC-56 TENANT-13c — verification only (see secret-reader.port.ts). A missing secret is null, never a throw. */
  async readTenantSecret(secretRef: string): Promise<string | null> {
    const client = await this.sm();
    return this.resilience.run('aws.secretsmanager.get', async () => {
      try {
        const out = await client.send(new this._mod.GetSecretValueCommand({ SecretId: secretRef }));
        return typeof out.SecretString === 'string' ? (out.SecretString as string) : null;
      } catch (e: any) {
        if (e?.name === 'ResourceNotFoundException') return null;
        throw e;
      }
    }, { retries: 1 });
  }
}
