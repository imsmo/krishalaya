// apps/web-partner/src/lib/env.ts · the ONLY env reader for the partner portal. PC-56 PARTNER-0: a partner person signs in TO THEIR PARTNER
// ORGANISATION (the API's partner realm: a token with `pid` + `realm`, no tenant); the API decides what they can see (the consented
// applications on their own products), never the client. Only NEXT_PUBLIC_* reaches the browser; fails closed if the API origin is unset.
// F-13: the app's name is the platform's (PLATFORM_BRAND, packages/tokens — the one brand-mark list), never a literal here.
import { PLATFORM_BRAND } from '@krishalaya/tokens';

const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!publicApiUrl) throw new Error('web-partner: NEXT_PUBLIC_API_URL is required');

export const env = {
  publicApiUrl,
  serverApiUrl: process.env.API_URL_INTERNAL || publicApiUrl,   // server-side SSR origin (never shipped to the client)
  appName: PLATFORM_BRAND.name,
  // single source for the NODE_ENV gate (so other modules never read process.env directly)
  isProduction: process.env.NODE_ENV === 'production',
} as const;
