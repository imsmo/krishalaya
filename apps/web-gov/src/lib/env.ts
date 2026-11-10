// apps/web-gov/src/lib/env.ts · the ONLY env reader of the GOVERNMENT console (PC-56 GOV-1a, survey C-8: the tenant console's tenant id and
// fifteen feature switches were copied here and read by nothing — removed). Still no secrets in the browser bundle (only NEXT_PUBLIC_*
// reaches the client). Fails closed if the API origin is unset. The platform switch `gov_console` is read from the API's public flag map,
// never from an env variable.
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!publicApiUrl) throw new Error('web-gov: NEXT_PUBLIC_API_URL is required');

export const env = {
  publicApiUrl,
  serverApiUrl: process.env.API_URL_INTERNAL || publicApiUrl,   // server-side SSR origin (never shipped)
  appName: 'Krishalaya',
} as const;
