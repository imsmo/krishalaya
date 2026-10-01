// modules/identity/domain/kyc-cursor.ts · the KYC queue's keyset cursor = the shared microsecond-safe codec (F-7).
// The rule lives in `shared/pagination/us-keyset.ts` because the audit trail needs the same one (no module imports
// another module's internals).
export { encodeKeyset, decodeKeyset, UUID_RE, BIGINT_RE, US_SQL } from '../../../shared/pagination/us-keyset';
export type { KeysetCursor } from '../../../shared/pagination/us-keyset';
