// apps/web-storefront/src/app/(platform)/tenants-signup/page.tsx · PC-56 STORE-1c · C1 — the OLD address of the organisation landing page. Canon
// W307's route is `/for-organisations` (built there); this path answers a PERMANENT redirect (308) so every printed link, bookmark and
// search result still lands on the real page. The slug `tenants-signup` stays reserved (migration 0204) — a redirect is as unreachable as
// a page for an organisation that would take the name. The old marketing copy ("Sell on …", "secure payments and fast payouts",
// "traceability built in") is gone with it: every claim it made is answered on W307 (refused by name where it was not true).
import { permanentRedirect } from 'next/navigation';

export default function TenantsSignupPage(): never {
  permanentRedirect('/for-organisations');
}
