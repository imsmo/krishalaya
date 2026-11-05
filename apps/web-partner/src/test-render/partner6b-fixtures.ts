// apps/web-partner/src/test-render/partner6b-fixtures.ts · PC-56 PARTNER-6b · CONSENT AND THE FILINGS THE PLATFORM DOES NOT MAKE — the render
// tests' shared fixtures: the two pages read nothing, so there is no data fixture at all — only the mailbox fact, the canon's false words as
// visible-text regexes (the refusal list is stripped first — it names what it refuses), and the form-control regex. No person, institution,
// place, phone, application reference, figure or sha fragment from the canon.
export const MAILBOX_6B = { kind: 'published', address: 'partners@example.org' } as const;

/** W213's false words in VISIBLE text (outside the refusal list). */
export const FALSE_6B_CONSENTS = /revocab|time-?boxed|within \d+ seconds|both sides|standing access|your bank holds|provably|automatically|registry|\bactive\b|expiring|revoked|voice \(gu\)|app tap|\bNWR\b|\bLA-|\+91|•••|score|factors|compliance role|audit team|mirror|RBI|see plan settings|signed|Popat|Ramesh|Meera|Saurashtra|Gramin|\bAJ\b/i;
/** W224's false words in VISIBLE text (outside the refusal list). The statement's own "never gives … landholding" is legal; a classification
 *  by land is not. */
export const FALSE_6B_REGULATORY = /%|₹|\bPSL\b|priority[- ]sector|weaker[- ]section|small (&|and) marginal|marginal|women|female|landholding\s*(≤|<=|of|under|\d)|land records|from KYC|signed|sha256|watermark|manifest|hash|Q\d pack|quarterly|RBI|DSB|compliance (role|team)|auditor|evidence|see plan settings|pre-shaped|qualifying|sub-target|Saurashtra|Gramin|\bAJ\b/i;

/** Any form control at all. */
export const FORM_CONTROL_6B = /<input|<select|<textarea|<form|<label|<button|\bfor="/i;
