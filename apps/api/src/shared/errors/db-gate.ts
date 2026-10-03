// shared/errors/db-gate.ts · PC-56 TENANT-SW-a — read the `[CODE]` token a maker-checker trigger raises (13b's mapTriggerError shape,
// shared). The DATABASE is the wall; a service only NAMES the refusal so the console can print it. Anything without a token is not a
// gate refusal and is re-thrown untouched.
export interface GateRefusal { code: string; message: string }

/** `[COMMISSION_CHECKER_IS_MAKER] the person who … — PC-56 …` → { code, message } (the message without the trailing wave tag). */
export function gateRefusal(e: unknown): GateRefusal | null {
  const msg = String((e as { message?: string })?.message ?? '');
  const m = /\[([A-Z][A-Z0-9_]{2,60})\]\s*(.*)$/s.exec(msg);
  if (!m) return null;
  return { code: m[1], message: m[2].replace(/\s+—\s+PC-56[^]*$/, '').trim() };
}
