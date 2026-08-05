// apps/mobile/src/core/flags/flags.ts · client feature flags + KILL-SWITCH (Law 10 / guide §6). Every shippable
// feature is gated here so ops can disable a bad screen remotely WITHOUT an app-store release. Resolution order
// (highest wins): remote config (hydrated at boot from the server) → build-time env override
// (EXPO_PUBLIC_FLAGS="voice_listing=on,listing_boost=off") → the hard-coded DEFAULTS below. New/risky features
// default OFF; only verified, shipped verticals default ON. Pure + framework-free → unit-tested.

export type FlagKey =
  | 'farmer_app'        // the farmer role vertical (shipped Wave 0) — GA-intended, killable
  | 'voice_listing'     // mic→STT listing — OFF until ai-services voice-extraction is exposed via apps/api (GA AI wave)
  | 'listing_boost'     // paid boost via wallet — OFF until payments land
  | 'payments_addmoney' // wallet add-money via Razorpay (P-03) — OFF until staging-verified
  | 'wallet'            // wallet vertical: transactions/withdraw/payout-history/detail (P-06) — OFF until verified
  | 'wallet_p2p'        // peer-to-peer wallet transfer ("Send") — post-GA, no backend endpoint yet (R2-06); the
                         // wallet HUB's Send tile only renders when this is on. OFF at pilot (default OFF)
  | 'orders_fulfilment' // order lifecycle actions + PoD + track + review + report (P-07) — OFF until verified
  | 'buyer_checkout'    // buyer cart → checkout → place+pay order (P-09) — OFF until verified
  | 'offers_chat'       // offers negotiation + chat + masked call (P-10) — OFF until verified
  | 'support'           // helpdesk support tickets + their chat thread (P-22, screen 520, KV-BL-034/052) — mirrors
                         // the SERVER flag key `support` exactly (core/feature-flags/flags.guard.ts's
                         // @FeatureFlag('support') on apps/api's TicketsController) so GET /v1/config/flags relays
                         // the kill-switch verbatim, no name-mapping needed. A support thread is NOT a buyer↔seller
                         // negotiation — it must not share `offers_chat`'s gate (MF-01's note on ChatThreadScreen:
                         // the (buyer) tab group's `buyer_app` kill-switch used to collaterally block support/other
                         // threads; the same over-broad-gate mistake, one level down, was `offers_chat` gating
                         // support chat too) — OFF until verified
  | 'auctions'          // auction discovery + bidding (EMD) + create (P-11) — OFF
  | 'mandi_weather'     // mandi prices + price alerts + weather advisories (P-19) — OFF until verified
  | 'tips_assistant'    // tips library + crop hub + AI assistant + voice search (P-20) — OFF until verified
  | 'voice_assistant'   // "Tap to speak" mic on the Farm Assistant (screen 125) — the assistant's TEXT Q&A
                         // (POST ai/assistant/messages) is fully built + governed (P1-13, apps/api `assistant`
                         // module) and already degrades honestly turn-by-turn without a model key; on-device STT
                         // itself works (core/voice, same engine as `voice_listing`), but per R2-03 the mic is
                         // still gated separately so ops can kill just the voice affordance without touching the
                         // (working) text assistant — same pattern as `voice_listing` gating listing/new.tsx's mic
                         // one screen over. OFF until verified on-device for the assistant's (longer, freer-form)
                         // farming questions
  | 'schemes_govt'      // govt schemes: browse + eligibility + apply + doc upload + status/DBT (P-21) — OFF until verified
  | 'farmer_profile'    // farmer profile/farm/bank/docs + help/complaint (support SLA) (P-22) — OFF until verified
  | 'system_screens'    // global search + settings + DPDP export/delete + change-phone + feedback (P-23) — OFF until verified
  | 'ota_updates'       // expo-updates OTA check/fetch/reload on foreground (P-32) — OFF until verified
  | 'release_gate'      // forced-update floor: block the app when current < min supported version (P-32) — OFF (kill-switch)
  | 'worker_active_job' // worker active-job: attendance geofence + earnings + withdraw + reviews (P-13) — OFF
  | 'labour_hire'       // farmer/employer hire: browse workers + post booking + lifecycle (P-14) — OFF
  | 'kyc'               // KYC doc submit/status (P-03) — OFF until staging-verified
  | 'notifications'     // push + in-app notification center (P-04) — OFF until staging-verified
  | 'ambassador_app'    // village ambassador: home + referral-led farmer onboarding + earnings (P-15) — OFF
  | 'ambassador_training' // ambassador commissions + withdraw + training/courses/quiz + profile (P-16) — OFF
  | 'buyer_app' | 'worker_app' | 'trader_app' | 'tenant_admin_lite' // future verticals — OFF
  // [DEV-11, 2026-07-24] the 3 keys below did not exist before this batch — added so the Group-B genuine-gap
  // screens (features/{fintech,dairy,livestock}/screens/*, DEV-08 census §2) can gate honestly per Golden Law 8
  // instead of rendering with no flag at all. Master-plan §2.2 rows 2/4/5 name these pilot-OFF ("GA Wave 2"/
  // "GA Wave 3"); no module exists behind any of the three yet, so ON also degrades to a coming-soon EmptyState
  // (see core/flags/off-module-state.ts), never a fabricated real screen.
  | 'fintech'           // loans/credit-score/insurance (P-2.2 row 2) — OFF, GA Wave 2
  | 'dairy'             // MCC/milk-diary/bill/D2C subscription (P-2.2 row 4) — OFF, GA Wave 3
  | 'livestock'         // animal profile/health log/vet booking (P-2.2 row 5) — OFF, GA Wave 3
  // [DEV-12, 2026-07-24] the 6 keys below did not exist before this batch — founder-approved mirror of DEV-11
  // (Founder Review Queue item 2, DEV-S1 sitting 2026-07-24): 6 operator-role feature dirs
  // (features/{mcc-operator,vet,store-owner,vyapari-home,delivery-partner,fpo-coordinator}/screens/*, DEV-08
  // census §2 Group-B genuine gap — zero matching `app/**` route group for any, none named in master-plan
  // §2.1/§2.2) gate honestly per Golden Law 8 instead of rendering with no flag at all. None of these 6 operator
  // roles has a mobile module built yet, so ON also degrades to a coming-soon EmptyState (see
  // core/flags/off-module-state.ts), never a fabricated real screen.
  | 'mcc_operator'      // MCC (milk chiller centre) operator console: BMC status/member lookup/shift close/
                        // collection slip — no mobile route group exists; a web partner-console equivalent may
                        // exist per the Design Program (W-D41 MCC POS/BMC screens) — OFF
  | 'equipment_owner'    // equipment-owner (CHC) role app — PC-50 W10-6, canon screens 308–312
  | 'vet'               // veterinarian professional console: bookings/calendar/prescriptions/earnings — distinct
                        // from the farmer-facing `livestock` flag's vet-BOOKING screen (that's the farmer booking
                        // a vet; this is the vet's OWN practice-management console) — no mobile route group
                        // exists; a web partner console exists per Design Program (screens 450-460) — OFF
  | 'store_owner'       // agri-input store owner console: inventory/orders/licence renewal/batch expiry — no
                        // mobile route group exists, no web partner console found either — OFF
  | 'vyapari'           // vyapari (wholesale trader) home console: market dashboard/requirements
                        // inbox/supplier shortlist — no mobile route group exists — OFF
  | 'delivery_partner'  // delivery/last-mile partner console: route map/tasks/pickup OTP/PoD/earnings — no
                        // mobile route group exists; a web logistics partner console exists per Design Program
                        // (W-D26/27) — OFF
  | 'fpo_coordinator';  // FPO group-lot coordinator console: create group lot/member pledges/settlement/members
                        // — no mobile route group exists; DEV-08 census register cross-ref row 18 (screen 261
                        // area) notes no FPO directory/search screen exists in the canon either — OFF

// Defaults: OFF unless the vertical is built AND verified. Flip a future vertical's default to true only when it
// ships; production can still kill any of these via remote config.
const DEFAULTS: Record<FlagKey, boolean> = {
  farmer_app: true,
  voice_listing: false,
  listing_boost: false,
  payments_addmoney: false,
  wallet: false,
  wallet_p2p: false,
  orders_fulfilment: false,
  buyer_checkout: false,
  offers_chat: false,
  support: false,
  auctions: false,
  mandi_weather: false,
  tips_assistant: false,
  voice_assistant: false,
  schemes_govt: false,
  farmer_profile: false,
  system_screens: false,
  ota_updates: false,
  release_gate: false,
  worker_active_job: false,
  labour_hire: false,
  kyc: false,
  notifications: false,
  buyer_app: false,
  worker_app: false,
  trader_app: false,
  ambassador_app: false,
  ambassador_training: false,
  tenant_admin_lite: false,
  fintech: false,
  dairy: true, // PC-50 W10-2: Phase-2 activation — the dairy-farmer app is BUILT (app/(dairy))
  livestock: true, // PC-50 W10-1: Phase-2 activation — the Pashupalak app is BUILT (app/(pashupalak))
  mcc_operator: true, // PC-50 W10-7: Phase-2 activation — the MCC-counter app is BUILT (app/(mcc))
  vet: true, // PC-50 W10-3: Phase-2 activation — the vet-professional app is BUILT (app/(vet))
  store_owner: true, // PC-50 W10-4: Phase-2 activation — the store-owner app is BUILT (app/(store))
  vyapari: false,
  delivery_partner: true, // PC-50 W10-5: Phase-2 activation — the rider app is BUILT (app/(delivery))
  equipment_owner: true, // PC-50 W10-6: Phase-2 activation — the equipment-owner app is BUILT (app/(equipment))
  fpo_coordinator: false,
};

function parseEnvOverrides(raw: string | undefined): Partial<Record<FlagKey, boolean>> {
  if (!raw) return {};
  const out: Partial<Record<FlagKey, boolean>> = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=').map((s) => s.trim());
    if (k && k in DEFAULTS) out[k as FlagKey] = v === 'on' || v === 'true' || v === '1';
  }
  return out;
}

class FlagStore {
  private remote: Partial<Record<FlagKey, boolean>> = {};
  private readonly env = parseEnvOverrides(process.env.EXPO_PUBLIC_FLAGS);
  private readonly listeners = new Set<() => void>();

  /** Hydrate from the server's remote-config payload (call once at boot, then on refresh). Unknown keys ignored.
   * This is the KILL-SWITCH channel: setting a key false here disables the feature for everyone, instantly. */
  hydrate(remote: Partial<Record<string, boolean>>): void {
    const next: Partial<Record<FlagKey, boolean>> = {};
    for (const k of Object.keys(DEFAULTS) as FlagKey[]) if (k in remote) next[k] = !!remote[k];
    this.remote = next;
    this.listeners.forEach((l) => l());
  }

  isEnabled(key: FlagKey): boolean {
    if (key in this.remote) return this.remote[key]!;   // remote wins (kill-switch)
    if (key in this.env) return this.env[key]!;          // then build-time override
    return DEFAULTS[key];                                // then default (OFF for new features)
  }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export const flags = new FlagStore();
export function isEnabled(key: FlagKey): boolean { return flags.isEnabled(key); }
