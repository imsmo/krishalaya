// modules/communication/domain/fallback-languages.ts · PC-56 TENANT-8a (F-22) · the order in which a notification's
// languages are tried when the reader's own has no template.
//
// It was `FALLBACK_LANGS = ['en', 'hi']` for every tenant on the platform — so a Gujarati-first cooperative's member
// whose own language had no row fell back to HINDI before the cooperative's own Gujarati, and the order was a literal
// in the send path (Law 6: languages come from the DB). The order is now:
//
//     the reader's own language → the language the emitter named (if any) → THIS TENANT's languages in its own order
//     (`tenant_languages`: the default first, then the registry's sort order) → English, last.
//
// English stays as the final rung because it is the one language every platform default is authored in first (en 92
// of 224 platform rows live) — it is the rung most likely to exist, not a preference. A tenant that has declared no
// languages gets [reader, emitter, en]: nothing in apps/api writes `tenant_languages` today (7b's grep), and a Hindi
// rung for a tenant that never said it speaks Hindi was exactly the guess this function removes.
export const LAST_RESORT_LANGUAGE = 'en';

export function fallbackChain(readerLang: string | null | undefined, emitterLang: string | null | undefined, tenantLangs: readonly string[]): string[] {
  const raw = [readerLang, emitterLang, ...tenantLangs, LAST_RESORT_LANGUAGE];
  const out: string[] = [];
  for (const l of raw) {
    const s = (l ?? '').trim();
    if (s.length > 0 && !out.includes(s)) out.push(s);
  }
  return out;
}
