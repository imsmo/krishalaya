'use server';
// apps/web-storefront/src/app/notifications/preferences/actions.ts · save notification preferences + quiet hours.
// AUTHENTICATED (requireSession). Both are full-replace PUTs (idempotent by nature → no Idempotency-Key in the
// SDK). Preferences are encoded so the server gets the COMPLETE matrix back: each event×channel pair rides as a
// hidden `pref` field (eventCode::channel); a checkbox is present (in `enabled`) only when the user opted in — so
// isEnabled = the pair is in the checked set. A mandatory event can't be disabled (the server rejects it); we
// surface that generically. revalidate so the saved state shows.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { NotificationPreference, QuietHours } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';

const PREFS_PATH = '/notifications/preferences';

export async function savePreferencesAction(formData: FormData): Promise<void> {
  await requireSession(PREFS_PATH);
  const pairs = formData.getAll('pref').map(String);
  const enabled = new Set(formData.getAll('enabled').map(String));
  const preferences: NotificationPreference[] = [];
  for (const key of pairs) {
    const [eventCode, channel] = key.split('::');
    if (eventCode && channel) preferences.push({ eventCode, channel, isEnabled: enabled.has(key) });
  }
  try {
    await serverClient().notifications.setPreferences(preferences);
  } catch {
    redirect(`${PREFS_PATH}?status=preferr`); // e.g. tried to disable a mandatory event
  }
  revalidatePath(PREFS_PATH);
  redirect(`${PREFS_PATH}?status=prefsaved`);
}

export async function saveQuietHoursAction(formData: FormData): Promise<void> {
  await requireSession(PREFS_PATH);
  const starts = String(formData.get('starts') ?? '').trim();
  const ends = String(formData.get('ends') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim();
  // Expect HH:MM times + a non-empty IANA timezone; bad input → generic error (server re-validates too).
  if (!/^\d{2}:\d{2}$/.test(starts) || !/^\d{2}:\d{2}$/.test(ends) || !timezone) {
    redirect(`${PREFS_PATH}?status=qherr`);
  }
  const input: QuietHours = { starts, ends, timezone };
  try {
    await serverClient().notifications.setQuietHours(input);
  } catch {
    redirect(`${PREFS_PATH}?status=qherr`);
  }
  revalidatePath(PREFS_PATH);
  redirect(`${PREFS_PATH}?status=qhsaved`);
}
