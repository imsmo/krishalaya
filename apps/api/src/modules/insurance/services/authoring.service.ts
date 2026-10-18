// modules/insurance/services/authoring.service.ts · PC-54 W54-9 `insurance-authoring` — LOCKED DOWN by PC-56 PARTNER-2a (survey F-1 / F-3 /
// F-5; founder Q5 + Q7 + Q10, 2026-10-18 — the wave's FIRST commit).
//
// WHAT THIS WAS: a TENANT act. Any FPO's `tenant_admin` (and `insurance_agent`) could create an insurance product for ANY financial partner
// and PATCH ANY insurer's `premium_calc`, name or `is_active` platform-wide (`insurance_products` is global reference data with no RLS), with
// no flag, no audit row and a premium shape enrolment could never price; and could "issue" a policy — a raw status UPDATE outside the state
// machine that, in the normal path, could only ever answer 409 (a captured payment activates the policy in the same write that links it).
//
// WHAT IT IS NOW:
//   • createProduct / updateProduct → REFUSED BY NAME (`INSURANCE_PRODUCT_PLATFORM_AUTHORED`, 403): products are authored by the PLATFORM in
//     the admin realm after a signed agreement (founder Q7) — that writer is NOT built here (named: it rides with the `insurance_kind` lookup
//     type and values on the platform's authoring wave, and writes its own audit row there);
//   • issue → REFUSED BY NAME (`INSURANCE_ISSUE_NOT_ON_PLATFORM`, 403): the insurer does not issue on the platform in Phase 1 (founder Q5);
//   • book / insights → unchanged TENANT reads of the tenant's OWN members under tenant RLS, behind the `insurance` flag (named, survey F-12:
//     they still return `holder_user_id` to the FPO's own `insurance.manage` holders — inside the tenant wall, not across it).
// NO AUTHORING WRITE SURVIVES FROM THE TENANT REALM: the repository's INSERT / UPDATE methods are removed with the routes' bodies. The one
// premium shape lives in `domain/premium-calc.ts` (`isAuthorablePremiumCalc` = `parsePremiumCalc`): whoever authors later inherits it.
import { Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../../shared/errors/app-error';
import { AuthoringRepository } from '../repositories/authoring.repository';
import { InsuranceIssueNotOnPlatformError, InsuranceProductPlatformAuthoredError } from '../domain/insurance.errors';

export interface InsActor { userId: string; canManage: boolean }

@Injectable()
export class AuthoringService {
  constructor(private readonly repo: AuthoringRepository) {}
  private assert(a: InsActor) { if (!a.canManage) throw new ForbiddenError('requires insurance.manage'); }

  /** Founder Q7 — refused by name; nothing is read, nothing is written. */
  createProduct(): never { throw new InsuranceProductPlatformAuthoredError(); }
  /** Founder Q7 — refused by name; the product row is never touched. */
  updateProduct(): never { throw new InsuranceProductPlatformAuthoredError(); }
  /** Founder Q5 — refused by name; the policy row is never touched. */
  issue(): never { throw new InsuranceIssueNotOnPlatformError(); }

  book(tenantId: string, a: InsActor, status?: string, limit = 100) { this.assert(a); return this.repo.book(tenantId, status, Math.min(limit, 200)); }
  insights(tenantId: string, a: InsActor) { this.assert(a); return this.repo.insights(tenantId); }
}
