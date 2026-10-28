// apps/web-partner/src/lib/lender.ts · PC-56 PARTNER-2c — the lender pages' shared server pieces: the KIND gate (an insurer who opens a lender
// page is sent to its own dashboard — the 1a lending dashboard's rule, `wrongConsole(kind, 'lender')`) and the failure reading (a 404 while the
// console's flag is OFF → the switched-off sentence; a named 404 for an absent product; anything else is the error state). The platform's
// `fintech` flag is a TENANT module switch: the partner realm does not read it (the 1a dashboard does not either).
import 'server-only';
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { partnerClient } from './api-client';
import { partnerConsoleSwitch } from './console-flag';
import { failureOf } from '../features/partner1/dashboard';
import { wrongConsole } from '../features/partner2/figures';

/** Read `/me`; send an insurer to its own dashboard. A failed `/me` opens or closes nothing by a guess (the page's own read answers). */
export async function lenderGate(): Promise<void> {
  const me = await partnerClient().partner.me().catch(() => null);
  if (wrongConsole(me?.organisation?.kind, 'lender')) redirect('/insurer/dashboard');
}

/** A failed shelf read → 'off' (the console is switched off) or 'error'. */
export async function lenderFailure(e: unknown): Promise<'off' | 'error'> {
  const status = e instanceof SdkError ? e.status : undefined;
  return failureOf(status, status === 404 ? await partnerConsoleSwitch() : 'unknown');
}
export const isLoanProductNotFound = (e: unknown) => e instanceof SdkError && e.status === 404 && e.code === 'PARTNER_LOAN_PRODUCT_NOT_FOUND';
/** PC-56 PARTNER-4a: a loan outside this lender's own book and an absent id answer the SAME named 404 — never "not yours". */
export const isLoanNotFound = (e: unknown) => e instanceof SdkError && e.status === 404 && e.code === 'PARTNER_LOAN_NOT_FOUND';
