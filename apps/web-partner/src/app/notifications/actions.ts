'use server';
// apps/web-partner/src/app/notifications/actions.ts · shared-rail mutations (PC-2C): mark-read, the COMPLETE
// preference matrix (full replace — the API contract), quiet hours, and consent toggles (Idempotency-Key —
// consent records are append-only server-side). All caller-scoped by the partner token.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { partnerClient } from '../../lib/api-client';
import { requirePartner } from '../../lib/session';
import type { NotificationPreference } from '@krishalaya/sdk-js';

export async function markReadAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/notifications');
  try { await partnerClient().notifications.markRead(id); } catch { /* degrade: stays unread */ }
  revalidatePath('/notifications');
  redirect('/notifications');
}

export async function savePreferencesAction(formData: FormData): Promise<void> {
  await requirePartner();
  const rows = formData.getAll('pref').map(String); // "eventCode|channel" for every matrix cell
  const preferences: NotificationPreference[] = rows.map((key) => {
    const [eventCode, channel] = key.split('|');
    return { eventCode, channel, isEnabled: formData.get(`on:${key}`) === '1' };
  }).filter((p) => p.eventCode && p.channel);
  try { await partnerClient().notifications.setPreferences(preferences); }
  catch { redirect('/notifications/preferences?error=prefs'); }
  revalidatePath('/notifications/preferences');
  redirect('/notifications/preferences?ok=prefs');
}

export async function saveQuietHoursAction(formData: FormData): Promise<void> {
  await requirePartner();
  const starts = String(formData.get('starts') ?? '').trim();
  const ends = String(formData.get('ends') ?? '').trim();
  if (!/^\d{2}:\d{2}$/.test(starts) || !/^\d{2}:\d{2}$/.test(ends)) redirect('/notifications/preferences?error=quiet');
  try { await partnerClient().notifications.setQuietHours({ starts, ends, timezone: 'Asia/Kolkata' }); }
  catch { redirect('/notifications/preferences?error=quiet'); }
  revalidatePath('/notifications/preferences');
  redirect('/notifications/preferences?ok=quiet');
}

export async function setConsentAction(formData: FormData): Promise<void> {
  await requirePartner();
  const purposeCode = String(formData.get('purposeCode') ?? '').trim();
  const granted = String(formData.get('granted') ?? '') === '1';
  if (!purposeCode) redirect('/consents');
  try { await partnerClient().privacy.setConsent(purposeCode, granted, randomUUID()); }
  catch { redirect('/consents?error=consent'); }
  revalidatePath('/consents');
  redirect('/consents?ok=consent');
}
