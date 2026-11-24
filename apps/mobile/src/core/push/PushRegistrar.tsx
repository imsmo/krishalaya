// apps/mobile/src/core/push/PushRegistrar.tsx · PC-56 MOB-STORE-1 — registers this device for push for ANY signed-in role
// (registration-policy.ts) and attaches the tap router. Renders nothing. Mounted once inside AuthProvider by the root
// layout; replaces the farmer-only startPush() call the (farmer) tab layout used to make. Best-effort (Law 12).
import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/auth.store';
import { useFlag } from '../flags/useFlag';
import { startPush } from './push';
import { shouldRegisterPush } from './registration-policy';

export function PushRegistrar(): null {
  const { state } = useAuth();
  const notificationsOn = useFlag('notifications');
  const roleRef = useRef(state.activeRole);
  roleRef.current = state.activeRole;
  const enabled = shouldRegisterPush({ status: state.status, activeRole: state.activeRole, notificationsOn });

  useEffect(() => {
    if (!enabled) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    startPush(() => roleRef.current)
      .then((c) => { if (cancelled) c(); else cleanup = c; })
      .catch(() => { /* push is best-effort */ });
    return () => { cancelled = true; cleanup?.(); };
  }, [enabled]);
  return null;
}
