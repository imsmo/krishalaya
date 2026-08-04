// apps/web-partner/src/lib/env.ts · the ONLY env reader for the partner portal. Partners (banks/NBFCs/insurers)
// authenticate against the SAME platform API as tenants, but their token carries partner-scoped permissions
// (loan.manage etc.) — the API decides what they can see (consented applications only), never the client. Only
// NEXT_PUBLIC_* reaches the browser; fails closed if the API origin is unset.
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!publicApiUrl) throw new Error('web-partner: NEXT_PUBLIC_API_URL is required');

export const env = {
  publicApiUrl,
  serverApiUrl: process.env.API_URL_INTERNAL || publicApiUrl,   // server-side SSR origin (never shipped to the client)
  appName: 'Krishalaya Partner',
  // single source for the NODE_ENV gate (so other modules never read process.env directly)
  isProduction: process.env.NODE_ENV === 'production',
} as const;
