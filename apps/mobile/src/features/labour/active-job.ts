// apps/mobile/src/features/labour/active-job.ts · PURE stopwatch/phase logic for the worker Active-Job screen
// (screen 33). No React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. It derives the elapsed
// worked-time DISPLAY from the server-stamped clock-in time (never money — the wage is settled server-side on
// completion, Law 2; we never compute a running rupee figure on the client).
import type { LabourAttendance } from '@krishalaya/sdk-js';

export type AttendancePhase = 'none' | 'working' | 'done';

/** The worker's current phase for this job: no open attendance yet, actively clocked-in, or clocked-out/confirmed.
 * Pure. */
export function attendancePhase(att: LabourAttendance | null): AttendancePhase {
  if (!att || !att.status) return 'none';
  if (att.status === 'clocked_in') return 'working';
  return 'done'; // clocked_out | confirmed
}

/** Seconds actually worked = (now − clockIn) minus the declared unpaid break, floored at 0. A missing/unparseable
 * clock-in → 0. This is a display timer only. Pure. */
export function elapsedWorkedSeconds(clockInAtIso: string | null | undefined, breakMinutes: number | null | undefined, nowMs: number = Date.now()): number {
  const t = clockInAtIso ? Date.parse(clockInAtIso) : NaN;
  if (Number.isNaN(t)) return 0;
  const gross = Math.floor((nowMs - t) / 1000);
  const brk = Math.max(0, Math.floor((breakMinutes ?? 0) * 60));
  return Math.max(0, gross - brk);
}

/** Format whole seconds as a zero-padded HH:MM:SS stopwatch. Negatives clamp to 0. Pure. */
export function formatStopwatch(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}
