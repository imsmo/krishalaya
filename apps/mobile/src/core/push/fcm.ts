// apps/mobile/src/core/push/fcm.ts · push registration: request notification permission (JUST-IN-TIME, guide §8),
// obtain the Expo push token (FCM under the hood on Android), and set the Android notification channel. The token
// is then synced to the server so it can target this device.
//
// FLAG CLOSED (PC-21, 2026-08-04): the `notifications/devices` POST/DELETE routes now exist in the api
// (communication devices.controller) + sdk-js (notifications.registerDevice/revokeDevice). syncPushToken keeps
// its degrade-on-failure shape (offline-first, Law 12) and now also remembers the last synced token so
// revokePushToken() can un-target this device on sign-out (privacy). We never fake success and never log the token.
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { apiClient } from '../api/client';

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null; // push tokens aren't issued on simulators
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status; // JIT prompt
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  try {
    // MF-11: getExpoPushTokenAsync WITHOUT a projectId is deprecated and spams a warning toast on
    // every boot in dev. The projectId only exists once EAS is configured (launch-phase task) —
    // until then, skip token registration cleanly instead of warning. Reads app.json/app.config
    // extra.eas.projectId when present.
    const projectId: string | undefined =
      (Constants?.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return null; // no EAS project yet — push registration is a no-op (Law 12 degrade)
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token || null;
  } catch {
    return null; // degrade — push is best-effort, never blocks the app (Law 12)
  }
}

let lastSyncedToken: string | null = null;

/** Best-effort token sync. No-ops on any failure (offline etc.). Never logs the token. */
export async function syncPushToken(token: string): Promise<void> {
  try {
    await apiClient().request('POST', 'notifications/devices', { body: { platform: Platform.OS, token } });
    lastSyncedToken = token;
  } catch {
    /* offline / transient — degrade; next start() re-syncs (registration is idempotent server-side) */
  }
}

/** Best-effort token revoke on sign-out — the server must stop targeting a signed-out device (privacy).
 *  Called while the session token is still attached; degrades silently (idempotent server-side). */
export async function revokePushToken(): Promise<void> {
  const token = lastSyncedToken;
  if (!token) return;
  lastSyncedToken = null;
  try {
    await apiClient().request('DELETE', 'notifications/devices', { body: { token } });
  } catch {
    /* offline — degrade; the token also dies naturally when the push provider rotates it */
  }
}
