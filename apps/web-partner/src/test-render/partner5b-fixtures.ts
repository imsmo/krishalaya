// apps/web-partner/src/test-render/partner5b-fixtures.ts · PC-56 PARTNER-5b · COLLECTIONS THE PLATFORM DOES NOT DO — the render tests'
// shared fixtures. The three honest pages READ NOTHING, so there is no response to fake: the fixtures are the ids a page may be opened with
// (a real-looking loan id, a foreign one, an unknown one and malformed ones — every one must print the SAME page), the canon's false words
// as one visible-text regex, and the "no digit beside an arrears word" scan in all three languages. No person, bank, place, case or loan
// number, scheme or avatar.

/** Every id a case / restructure page may be opened with. The page looks nothing up, so all of them print the same page. */
export const IDS = {
  loan: '0192d2c4-b0b0-7000-8000-00000000c0de',
  foreign: '0192d2c4-b0b0-7000-8000-0000000f0e19',
  unknown: '00000000-0000-0000-0000-000000000000',
  malformed: 'not-a-uuid',
  hostile: '"><script>alert(1)</script>',
} as const;

/** The canon's false words, as they would appear in VISIBLE text (the refusal list is stripped first — it names what it refuses). */
export const FALSE_5B = /%|cure rate|named cases?\b|take next|promise[- ]to[- ]pay|last contact|contact log|transcript|field officer|mediation (scheduled|thu|agreed)|vet[- ]visit|milk volume|name (visible|in case view)|\+91|CASE-\d|LN-20\d\d|committee sign-?off|\bNPA\b|RBI norms|monsoon clause|rainfall|three humans|OTP \+ voice|think-it-over|comparison PDF|collections (role|lead)|platform-enforced|append-?only|see plan settings|after (the )?borrower accepts?|his choice|resets the tone|full contact history|every open is logged|versioned server-side|automatically past|DELTA-033|Backend pending|\bDPD\b|\bcurrent\b|lending is (switched )?off|your checker/i;

/** No digit within a few characters of an arrears, case, contact or promise word — in en, hi or gu (the 4c `figuresBesideLedgerWords` shape). */
export function figuresBesideArrearsWords(text: string): string[] {
  const WORDS = 'DPD|arrears|case|cases|contact|contacts|promise|promises|बकाया|मामला|मामले|संपर्क|वादा|બાકી|કેસ|સંપર્ક|વચન';
  const res = [
    new RegExp(`(?:${WORDS})[^.।॥]{0,24}?[\\d०-९૦-૯]`, 'gi'),
    new RegExp(`[\\d०-९૦-૯][^.।॥]{0,24}?(?:${WORDS})`, 'gi'),
  ];
  return res.flatMap((re) => text.match(re) ?? []);
}

/** Any form control at all — the canon's two inputs must never be rendered, and nothing else either. */
export const FORM_CONTROL = /<input|<select|<textarea|<form|<label|<button|\bfor="/i;
