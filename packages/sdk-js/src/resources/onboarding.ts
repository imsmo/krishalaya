// @krishalaya/sdk-js · self-serve onboarding resource (KV-BL-066, screens 04/433 role picker). An OTP-verified
// user starts with a bare account and no tenant role; this grants one of the pilot's self-serve-safe roles
// (farmer|customer today — see the API's SELF_SERVE_ALLOWED). Every other role code is rejected with a typed 403
// (SdkError.code === 'SELFSERVE_ROLE_NOT_ELIGIBLE', details.reason one of platform_role|invite_only|not_pilot_ga|
// unknown_role) so the picker can show an honest state (invite banner / "coming soon during pilot") instead of a
// generic failure. Idempotent (Law 3): re-selecting an already-held role returns the same 200 with
// alreadyGranted:true, no duplicate grant — so a retried tap or a double-request-header race is always safe.
import { HttpClient } from '../http';
import { OnboardRoleResult } from '../types';

export class OnboardingResource {
  constructor(private readonly http: HttpClient) {}

  /** Self-serve-grant a role on the caller's own account, in their current tenant. Throws SdkError (403,
   * SELFSERVE_ROLE_NOT_ELIGIBLE) for any role this pilot won't self-grant — inspect `details.reason`. */
  async selectRole(role: string, idempotencyKey: string): Promise<OnboardRoleResult> {
    return (await this.http.request<OnboardRoleResult>('POST', 'onboarding/roles', { idempotencyKey, body: { role } })).data;
  }
}
