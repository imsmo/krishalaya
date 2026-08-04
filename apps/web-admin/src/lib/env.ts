// apps/web-admin/src/lib/env.ts · the ONLY env reader for the god-mode console. Talks to admin-api (a SEPARATE
// security realm from the tenant API — Law 11). No secrets in the browser bundle. Fails closed if unset.
const publicAdminApiUrl = process.env.NEXT_PUBLIC_ADMIN_API_URL;
if (!publicAdminApiUrl) throw new Error('web-admin: NEXT_PUBLIC_ADMIN_API_URL is required');

export const env = {
  publicAdminApiUrl,
  serverAdminApiUrl: process.env.ADMIN_API_URL_INTERNAL || publicAdminApiUrl,
  appName: 'Krishalaya Admin',
  // single source for the NODE_ENV gate (so other modules never read process.env directly)
  isProduction: process.env.NODE_ENV === 'production',
} as const;
