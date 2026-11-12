// apps/mobile/src/core/push/push.ts · wires the push runtime: a foreground display handler (suppresses the local
// banner during the user's quiet hours), and a TAP handler that deep-links to the right screen via the pure
// router. start() registers for push (JIT) + syncs the token + attaches listeners; returns a cleanup. Safe to
// call once the user is authenticated. Degrade-never-die: any failure no-ops (push is best-effort).
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { registerForPush, syncPushToken } from './fcm';
import { routeForNotification } from './notification-router';
import { isWithinQuietHours } from './quiet-hours';

let quietWindow: { starts: string; ends: string } | null = null;
/** The app sets the user's quiet window (from their saved prefs) so foreground display can honor it locally. */
export function setQuietWindow(win: { starts: string; ends: string } | null): void { quietWindow = win; }

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const quiet = quietWindow ? isWithinQuietHours(new Date(), quietWindow.starts, quietWindow.ends) : false;
    return { shouldShowAlert: !quiet, shouldPlaySound: !quiet, shouldSetBadge: true };
  },
});

function payloadOf(resp: Notifications.NotificationResponse): { payload: Record<string, unknown>; eventCode: string } {
  const data = (resp.notification.request.content.data ?? {}) as Record<string, unknown>;
  return { payload: data, eventCode: String(data.eventCode ?? '') };
}

/** Start push: register + sync token + listen for taps. Returns a cleanup fn. */
export async function startPush(): Promise<() => void> {
  const token = await registerForPush();
  if (token) void syncPushToken(token);

  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    try {
      const { payload, eventCode } = payloadOf(resp);
      // Narrow cast (TSC-1): the route comes from a push payload at runtime (allow-listed by SAFE_INTERNAL_PATH or mapped
      // from the event code), so it cannot be one of the typed-routes literals at compile time.
      router.navigate(routeForNotification(payload, eventCode) as Href);
    } catch { /* never crash on a malformed push */ }
  });
  return () => sub.remove();
}
