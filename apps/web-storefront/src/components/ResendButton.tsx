'use client';
// apps/web-storefront/src/components/ResendButton.tsx · PC-56 STORE-1a · C6 — canon W322 "Resend in 0:24". The wait is the SERVER's
// (`resendInSec` from POST /v1/auth/otp, stored when the code was sent): rendered disabled with the seconds left, it counts down in the
// browser and enables itself at zero. Without JS it renders exactly the server's state (a reload shows the new one). The API's cooldown
// stays the real gate — an early press is refused with its own named wait.
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

export function ResendButton({ secondsLeft, idle, waiting, busy }: { secondsLeft: number; idle: string; waiting: string; busy: string }) {
  const [left, setLeft] = useState(Math.max(0, Math.floor(secondsLeft)));
  const { pending } = useFormStatus();
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [left]);
  const label = pending ? busy : left > 0 ? waiting.replace('{seconds}', String(left)) : idle;
  return (
    <button type="submit" className="kv-btn--link" disabled={pending || left > 0} aria-live="polite">
      {label}
    </button>
  );
}
