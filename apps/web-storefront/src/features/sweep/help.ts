// apps/web-storefront/src/features/sweep/help.ts · PC-56 STORE-SWEEP-a · C1 (founder D8 — F-2, the first thing built) — THE HELP PAGE TELLS THE TRUTH
// AND IS FLAG-AWARE. PURE.
//
// The live page promised "held until your order is fulfilled … the platform wallet" (false under pay-on-delivery, the seed), "track delivery from
// your account" (no tracking on the storefront) and "reach our support team from within your account" (no such door). Now:
//   • the money answer reads the STORE's `online_payments` (ON → the escrow sentence as founder D2 words it; OFF → "you pay on delivery; nothing
//     is held"); on the platform BOTH cases are printed (survey E5); a store whose flags cannot be read prints both, and says it could not read;
//   • "how do I buy" names the order page and its status (tracking is STORE-SWEEP-b's section — refused by name until then);
//   • the support line is replaced by the Contact page (platform) / "Message the organisation" (a store's own contact page);
//   • the canon's other questions are built where true (cart price change, refunds to source, the QR, checking the record, the quality promise,
//     the EMD, the auction clock, offers, language → the preferences page until SW-b's `/language`), the rest refused by name (refusals.ts).
// Under a store: organisation-neutral words only (the brand guard pins every `help.*` key a store renders — no platform name).

export type HelpSection = 'buying' | 'trace' | 'auctions' | 'account';
// PC-56 STORE-SWEEP-b · D3: + `language` (the language page — the "in your language" entry is re-pointed from preferences)
export type HelpLink = 'orders' | 'trace' | 'quality' | 'preferences' | 'signup' | 'language';
export interface HelpEntry {
  id: string; section: HelpSection; q: string;
  /** the answer key, or 'money' (the flag-aware answer) */
  a: string | 'money';
  link?: HelpLink;
  /** the platform's own question (opening an organisation's store) — never under a store's chrome */
  platformOnly?: true;
}

export const HELP_SECTIONS: readonly HelpSection[] = Object.freeze(['buying', 'trace', 'auctions', 'account'] as HelpSection[]);
export const HELP_ENTRIES: readonly HelpEntry[] = Object.freeze([
  { id: 'buy', section: 'buying', q: 'help.q1', a: 'help.a1', link: 'orders' },
  { id: 'money', section: 'buying', q: 'help.q2', a: 'money' },
  { id: 'price_change', section: 'buying', q: 'help.q3', a: 'help.a3' },
  { id: 'refunds', section: 'buying', q: 'help.q4', a: 'help.a4' },
  { id: 'qr', section: 'trace', q: 'help.q5', a: 'help.a5', link: 'trace' },
  { id: 'verify', section: 'trace', q: 'help.q6', a: 'help.a6', link: 'trace' },
  { id: 'quality', section: 'trace', q: 'help.q7', a: 'help.a7', link: 'quality' },
  { id: 'emd', section: 'auctions', q: 'help.q8', a: 'help.a8' },
  { id: 'clock', section: 'auctions', q: 'help.q9', a: 'help.a9' },
  { id: 'offer', section: 'auctions', q: 'help.q10', a: 'help.a10' },
  { id: 'language', section: 'account', q: 'help.q11', a: 'help.a11', link: 'language' },
  { id: 'open_store', section: 'account', q: 'help.platform.q', a: 'help.platform.a', link: 'signup', platformOnly: true },
] as HelpEntry[]);

export function helpEntries(chromeKind: 'platform' | 'tenant'): HelpEntry[] {
  return HELP_ENTRIES.filter((e) => chromeKind === 'platform' || !e.platformOnly);
}

export type MoneyCase = 'online' | 'on_delivery';
/** The money answer's cases: the platform prints both; a store prints its own (`online_payments` ON → online, else on delivery); a store whose
 *  flags could not be read prints both and says so (`unknown`). */
export function moneyCases(chromeKind: 'platform' | 'tenant', flags: { online_payments?: boolean } | null | undefined): { cases: MoneyCase[]; unknown: boolean } {
  if (chromeKind === 'platform') return { cases: ['online', 'on_delivery'], unknown: false };
  if (!flags) return { cases: ['online', 'on_delivery'], unknown: true };
  return { cases: [flags.online_payments === true ? 'online' : 'on_delivery'], unknown: false };
}
/** The answer key of each case (help.a2 = the escrow sentence; help.a2cod = pay on delivery, nothing held). */
export const MONEY_CASE_KEY: Readonly<Record<MoneyCase, string>> = Object.freeze({ online: 'help.a2', on_delivery: 'help.a2cod' });
