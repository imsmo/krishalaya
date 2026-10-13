'use client';
// apps/web-storefront/src/components/SubmitButton.tsx · PC-56 STORE-1a · C5 — canon W321 "Sending (idempotent): Button locks with
// 'Sending…' — a double-tap never fires two SMS." The only client JS on the sign-in screen besides the signal guard and the resend
// countdown: while the form's Server Action is in flight the button is disabled and says so. Without JS the form still posts (and the
// Idempotency-Key minted at render still makes a second identical post the same request).
import { useFormStatus } from 'react-dom';

export function SubmitButton({ idle, busy, className = 'kv-btn', describedBy }: { idle: string; busy: string; className?: string; describedBy?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending || undefined} aria-describedby={describedBy}>
      {pending ? busy : idle}
    </button>
  );
}
