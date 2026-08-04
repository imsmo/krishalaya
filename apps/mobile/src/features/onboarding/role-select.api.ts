// apps/mobile/src/features/onboarding/role-select.api.ts · data layer for screens 04/433 (role picker), KV-BL-066.
// Self-serve-grants a role on the caller's own account via POST /v1/onboarding/roles. Idempotency-keyed (Law 3):
// REVIEW NOTE: the Idempotency-Key here is per-CALL (fresh uuid each invocation) — the real no-double-grant
// guarantee is server-side: unique(user,tenant,role) + 23505 race handler + this screen's busy guard.
// — the server returns the same 200 either way. THROWS on failure so the screen can distinguish an honest
// ineligible-role 403 (SdkError.code === 'SELFSERVE_ROLE_NOT_ELIGIBLE', details.reason) from a transient error —
// never silently falls back to a fake local grant (Law 12: the server is the sole authority on roles).
import type { OnboardRoleResult } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export function grantRole(backendRoleCode: string): Promise<OnboardRoleResult> {
  return apiClient().onboarding.selectRole(backendRoleCode, newId());
}
