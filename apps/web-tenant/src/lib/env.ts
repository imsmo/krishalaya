// apps/web-tenant/src/lib/env.ts · the ONLY env reader. The tenant console is an AUTHENTICATED app — still no
// secrets in the browser bundle (only NEXT_PUBLIC_* reaches the client). Fails closed if the API origin is unset.
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!publicApiUrl) throw new Error('web-tenant: NEXT_PUBLIC_API_URL is required');

export const env = {
  publicApiUrl,
  serverApiUrl: process.env.API_URL_INTERNAL || publicApiUrl,   // server-side SSR origin (never shipped)
  appName: 'Krishalaya Console',
  /** The tenant this console instance serves. The API scopes login to a tenant, so the verify step must send it.
   *  In production this is derived from the host/subdomain; locally it's set explicitly via NEXT_PUBLIC_TENANT_ID. */
  tenantId: process.env.NEXT_PUBLIC_TENANT_ID,
  /** Console visibility switch for the auctions surface (hidden when 'false'). Enabled by default; the API's own
   *  `auctions` flag is the authoritative gate (if it's off, the reads simply degrade to an empty state). */
  featureAuctions: process.env.NEXT_PUBLIC_FEATURE_AUCTIONS !== 'false',
  /** Console visibility switch for the dairy MCC-operator surface. OFF by default (a vertical only some tenants
   *  run); the API's own `dairy` flag + `dairy.manage` perm remain the authoritative gates. */
  featureDairy: process.env.NEXT_PUBLIC_FEATURE_DAIRY === 'true',
  /** Console visibility switch for the labour employer-admin surface. OFF by default; the API's own `labour` flag
   *  + `worker.book`/`booking.manage` perms remain the authoritative gates. */
  featureLabour: process.env.NEXT_PUBLIC_FEATURE_LABOUR === 'true',
  /** Console visibility switch for the ambassadors admin surface. OFF by default; the API's own `ambassadors` flag
   *  + `ambassador.manage` perm remain the authoritative gates. */
  featureAmbassadors: process.env.NEXT_PUBLIC_FEATURE_AMBASSADORS === 'true',
  /** Console visibility switch for the scheme-assistant officer surface. OFF by default; the API's own `schemes`
   *  flag + `scheme.process` perm remain the authoritative gates. */
  featureSchemes: process.env.NEXT_PUBLIC_FEATURE_SCHEMES === 'true',
  /** Console visibility switch for the FPO group-lot coordinator surface. OFF by default; the API's own `group_lots`
   *  flag + `group_lot.coordinate` perm remain the authoritative gates. */
  featureGroupLots: process.env.NEXT_PUBLIC_FEATURE_GROUP_LOTS === 'true',
  /** Console visibility switch for the read-only auditor (audit-trail) surface. OFF by default; the API's own
   *  `audit_trail` flag + `audit.read` perm remain the authoritative gates. */
  featureAuditor: process.env.NEXT_PUBLIC_FEATURE_AUDITOR === 'true',
  /** Console visibility switch for the AI review-queue (human-in-the-loop) surface. OFF by default; the API's own
   *  `ai_governance` flag + `ai.review` perm remain the authoritative gates. */
  featureAiReview: process.env.NEXT_PUBLIC_FEATURE_AI_REVIEW === 'true',
  /** Console visibility switch for the education studio (PC-26). OFF by default; the API's own `education`
   *  flag + education.author/.publish perms remain the authoritative gates. */
  featureEducation: process.env.NEXT_PUBLIC_FEATURE_EDUCATION === 'true',
  /** Console visibility switch for the comms hub (PC-27: broadcasts + notification templates). OFF by default;
   *  the API's comm.manage perm remains the authoritative gate. */
  featureComms: process.env.NEXT_PUBLIC_FEATURE_COMMS === 'true',
  /** Console visibility switch for FPO memberships (PC-28). OFF by default; the API's `memberships` flag +
   *  membership.manage perm remain the authoritative gates. */
  featureMemberships: process.env.NEXT_PUBLIC_FEATURE_MEMBERSHIPS === 'true',
  /** PC-28b visibility switches (API perms/flags stay authoritative): promotions+coupons, market insights, inbox. */
  featurePromotions: process.env.NEXT_PUBLIC_FEATURE_PROMOTIONS === 'true',
  featureMarket: process.env.NEXT_PUBLIC_FEATURE_MARKET === 'true',
  featureInbox: process.env.NEXT_PUBLIC_FEATURE_INBOX === 'true',
  /** Console visibility switch for the requirements board (PC-28c). OFF by default; requirement.post/.quote
   *  perms remain the authoritative server gates. */
  featureRequirements: process.env.NEXT_PUBLIC_FEATURE_REQUIREMENTS === 'true',
} as const;
