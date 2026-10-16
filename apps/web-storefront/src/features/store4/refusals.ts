// apps/web-storefront/src/features/store4/refusals.ts · PC-56 HOTFIX-6 · C2 / brief §E — what the conversation page does NOT do, BY NAME. PURE.
// (The HOTFIX-4 shape — features/store2/refusals.ts — with STORE-3c's surfaces; STORE-4a/4b/4c extend THIS registry.) Each refused canon
// claim is listed ONCE with where the canon makes it and the surfaces it is PRINTED on (a refusal sentence — never an offer); the render test
// reads this map, so a refusal that disappears from its page — or the refused offer coming back into a catalogue (test/claims-guard.spec.ts)
// — turns a test red.
// PC-56 STORE-4a: + the person's pages — the account (W300), the address book (W301), the address form chain (W3034–W3037), the data download
// (W3029–W3030) and the deletion request (the W3031–W3033 shape) — their refusals live in features/store4a/refusals.ts.
export type Store4Surface = 'thread' | 'account' | 'addresses' | 'address_form' | 'data' | 'delete';
export interface Store4Refusal { id: string; canon: string; surfaces: readonly Store4Surface[]; key: string; why: string }

export const STORE4_HOTFIX6_REFUSALS: readonly Store4Refusal[] = Object.freeze([
  { id: 'call', canon: 'W298 "Call (protected)" · "Calls connect through a platform number — neither … sees the other\'s real phone (masked call, logged for safety)"',
    surfaces: ['thread'], key: 'store4.refusal.call',
    why: 'founder D2 (Q2): buyer calls are refused in Phase 1 until the cost owner and the consent notice are decided. The API route is made safe anyway (HOTFIX-6 B1: the callee is resolved by the server from the conversation; participant, membership and block checks; rate-limited) — the storefront offers no Call button and holds no person id' },
]);

/** The keys a surface prints (in registry order). */
export function store4RefusalKeys(surface: Store4Surface): readonly string[] {
  return STORE4_HOTFIX6_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)).map((r) => r.key);
}
