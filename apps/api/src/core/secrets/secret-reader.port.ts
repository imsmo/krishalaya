// core/secrets/secret-reader.port.ts · PC-56 TENANT-13c (F-8) · the READER half of the tenant-credential vault — FOR VERIFICATION ONLY.
//
// Until this wave there was a writer and no reader: a tenant's provider credential went into the vault and nothing ever read it back,
// which is why "connected" meant nothing. This port exists for ONE consumer: the daily re-verification of a connection
// (modules/tenant-integrations/jobs/integration-reverify.job.ts), which reads the vaulted credential, calls the provider's verification
// endpoint, and records the result. It is NOT a payments or SMS path: no money and no message moves on a tenant's credential today,
// and a spec pins the files allowed to inject SECRET_READER so a new reader is a reviewed change, not an accident.
export const SECRET_READER = Symbol('SECRET_READER');

export interface SecretReader {
  /** The plaintext stored under `secretRef`, or null when the vault no longer holds it (deleted, or a restarted local dev store). */
  readTenantSecret(secretRef: string): Promise<string | null>;
}
