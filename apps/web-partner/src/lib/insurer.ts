// apps/web-partner/src/lib/insurer.ts · PC-56 PARTNER-2a — the insurer pages' shared server pieces: the KIND gate (a lender or an asset
// manager who opens an insurer page is sent to its own dashboard; an insurer stays) and the failure reading (the API's named 404 for the
// platform's `insurance` flag; a 404 while the console's flag is OFF; anything else). `/me` answers `organisation.kind`
// (financial_partners.partner_kind) — read once per page; a failed `/me` never opens or closes anything by a guess (the page's own read
// then answers the switched-off or error state).
import 'server-only';
import { redirect } from 'next/navigation';
import { SdkError, type PartnerMe } from '@krishalaya/sdk-js';
import { partnerClient } from './api-client';
import { partnerConsoleSwitch } from './console-flag';
import { insurerFailureOf, wrongConsole, type InsurerFailure } from '../features/partner2/figures';

/** Read `/me`; send a non-insurer to `/dashboard`. Returns the organisation (or null when `/me` could not be read). */
export async function insurerGate(): Promise<PartnerMe['organisation']> {
  const me = await partnerClient().partner.me().catch(() => null);
  const org = me?.organisation ?? null;
  if (wrongConsole(org?.kind, 'insurer')) redirect('/dashboard');
  return org;
}

/** A failed insurer read → its state. */
export async function insurerFailure(e: unknown): Promise<InsurerFailure> {
  const status = e instanceof SdkError ? e.status : undefined;
  const code = e instanceof SdkError ? e.code : undefined;
  return insurerFailureOf(status, code, status === 404 && code !== 'PARTNER_INSURANCE_SWITCHED_OFF' ? await partnerConsoleSwitch() : 'unknown');
}
export const isNotFound = (e: unknown, code: string) => e instanceof SdkError && e.status === 404 && e.code === code;
