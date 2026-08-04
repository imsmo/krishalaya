// apps/web-storefront/src/app/manifest.ts · PWA web-app manifest (PC-24c). Served by Next at /manifest.webmanifest.
// Makes the storefront installable (browser-native install affordance on Android/desktop; iOS uses the
// apple-touch-icon + Add-to-Home-Screen). display:standalone + brand theme. No backend dependency.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Krishalaya Store',
    short_name: 'Krishalaya',
    description: 'Buy directly from farmer collectives — fresh produce, dairy, and farm inputs.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6faf6',
    theme_color: '#15803d',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
