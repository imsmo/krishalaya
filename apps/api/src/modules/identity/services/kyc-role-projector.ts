// modules/identity/services/kyc-role-projector.ts · PC-56 TENANT-9a · THE ONE PLACE A ROLE'S KYC STATUS IS WRITTEN.
//
// Every writer that used to call `setKycStatus(…, null, …)` — the self submission, the desk's review, the eKYC success —
// and the new expiry job call this instead, inside their own transaction. It reads the person's documents, the role map
// and the cooperative's date, and writes ONLY the roles the documents speak about whose derived status changed
// (`planRoleWrites`, pure). A role no document evidences is left exactly as recorded.
import { TxContext } from '../../../core/database/unit-of-work';
import { RoleWrite, planRoleWrites } from '../domain/kyc-role-scope';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';

export async function projectRoleKyc(
  tx: TxContext, tenantId: string, userId: string, kyc: KycDocumentRepository, utr: UserTenantRoleRepository,
): Promise<RoleWrite[]> {
  // Sequential on purpose: one transaction is one connection (pg refuses concurrent queries on a client).
  const roles = await utr.roleFacts(tx, tenantId, userId);
  const docs = await kyc.personDocFacts(tx, tenantId, userId);
  const map = await kyc.roleMap(tx);
  const today = await kyc.today(tx, tenantId);
  const writes = planRoleWrites(roles, docs, map, today);
  for (const w of writes) await utr.setRoleKycStatus(tx, tenantId, userId, w.roleCode, w.to);
  return writes;
}
