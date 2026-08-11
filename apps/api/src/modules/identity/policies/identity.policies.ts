// modules/identity/policies/identity.policies.ts · permission keys for the identity surface.
// These string keys are seeded into the permissions table (db/seeds 0004) and granted
// to roles there (dynamic RBAC, Law 6). Self-service endpoints need no permission (the
// caller acts on their own resources); admin endpoints require these.
export const IdentityPermissions = {
  Approve: 'user.approve',        // approve users/roles, review KYC, change status
  Impersonate: 'user.impersonate',
  Report: 'report.view',          // list/inspect users in a tenant
  TenantSettings: 'tenant.settings',
  /** PC-56 TENANT-1b · W153: "PII stays masked — full reveal is per-field, recorded, and reasoned." **Its own grant, never
   *  implied by the roster read**: seeing that a member EXISTS and seeing how to telephone them are different acts, and
   *  the screen's restricted state says so ("viewing needs member-desk scope; PII stays masked"). */
  RevealPii: 'member.pii.reveal',
} as const;
