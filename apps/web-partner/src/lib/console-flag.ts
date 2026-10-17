// apps/web-partner/src/lib/console-flag.ts · PC-56 PARTNER-0 · founder D6 / F-7 — IS THE PARTNER CONSOLE SWITCHED ON? Read through the
// platform's public, client-safe flag map (`GET /v1/config/flags` — booleans only, no targeting rules). Every /v1/partner/* route answers 404
// while `partner_console` is OFF; a page that gets a 404 asks THIS, and prints the switched-off sentence ("nothing is broken") instead of an
// outage. 'unknown' (the map could not be read) prints the ordinary unavailable notice — never a guess.
import 'server-only';
import { anonClient } from './api-client';

export type ConsoleSwitch = 'on' | 'off' | 'unknown';
export async function partnerConsoleSwitch(): Promise<ConsoleSwitch> {
  try {
    const r = await anonClient().request<Record<string, boolean>>('GET', 'config/flags', { anonymous: true });
    const v = r.data?.partner_console;
    return v === true ? 'on' : v === false ? 'off' : 'unknown';
  } catch { return 'unknown'; }
}
