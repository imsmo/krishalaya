'use server';
// apps/web-tenant/src/app/slot-proposal/[id]/actions.ts · the member's OTP link (no session) — PC-56 TENANT-SW-e. "Send me a code" asks
// the API to text a code to the member's OWN phone; "Accept" / "Decline" carries that code. The code travels in the POST body only —
// never a URL, never logged; the redirect carries only the outcome.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { anonClient } from '../../../lib/api-client';
import { isUuid, slotLinkHref } from '../../../features/swe/console';

export async function sendSlotCodeAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) redirect('/');
  try { await anonClient().pickupSlots.linkSendCode(id); }
  catch (e) { redirect(`${slotLinkHref(id)}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'unknown') : 'unknown')}`); }
  redirect(`${slotLinkHref(id)}?sent=1`);
}

export async function decideSlotLinkAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const code = String(formData.get('code') ?? '').replace(/\D/g, '').slice(0, 8);
  const decision = String(formData.get('decision') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 300);
  if (!isUuid(id) || (decision !== 'accept' && decision !== 'decline')) redirect('/');
  let done = '';
  try { done = (await anonClient().pickupSlots.linkDecide(id, { code, decision, reason: decision === 'decline' && reason ? reason : null })).status; }
  catch (e) { redirect(`${slotLinkHref(id)}?sent=1&error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'unknown') : 'unknown')}`); }
  redirect(`${slotLinkHref(id)}?done=${encodeURIComponent(done)}`);
}
