// apps/mobile/src/features/market/market.ts · PURE mandi-price + weather logic for P-19. No React/native (SDK/ui
// types are `import type` → erased) → unit-tested. Prices are bigint minor-unit strings (Law 2): the change-% is
// computed with BigInt (no precision loss on large paise values) and only the final percentage is a number for
// display. The SERVER is the authority on prices, predictions, alert firing (push), and advisories — these
// helpers only drive the UI.
import type { PillTone } from '@krishalaya/ui-native';
import type { MandiPrice, WeatherAlert, PriceAlert, ForecastDay } from '@krishalaya/sdk-js';

/** Percent change between two bigint-minor prices, as a number rounded to 1 dp (display only). Uses BigInt so a
 * huge price never loses precision; returns null if old is missing/zero or inputs are malformed. */
export function priceChangePct(oldMinor: string | null | undefined, newMinor: string | null | undefined): number | null {
  if (!oldMinor || !newMinor) return null;
  let o: bigint, n: bigint;
  try { o = BigInt(oldMinor); n = BigInt(newMinor); } catch { return null; }
  if (o <= 0n) return null;
  // ((n-o) / o) * 1000 as an integer (1 extra digit for 1dp rounding), then /10.
  const scaled = ((n - o) * 1000n) / o;
  return Number(scaled) / 10;
}

/** Trend tone/arrow from a change-% (UX): up=success, down=danger, flat=neutral. */
export function changeTone(pct: number | null): PillTone {
  if (pct == null || pct === 0) return 'neutral';
  return pct > 0 ? 'success' : 'danger';
}
export function changeArrow(pct: number | null): '▲' | '▼' | '—' {
  if (pct == null || pct === 0) return '—';
  return pct > 0 ? '▲' : '▼';
}

/** Whole-rupees → paise minor string for an alert threshold (positive integer), or undefined to reject. */
export function rupeesToThresholdMinor(rupees: string): string | undefined {
  const clean = (rupees ?? '').trim();
  if (!/^\d{1,13}$/.test(clean) || clean === '0') return undefined;
  try { return (BigInt(clean) * 100n).toString(); } catch { return undefined; }
}

export interface AlertDraft { ok: boolean; input?: { productId: string; regionId?: string | null; direction: 'above' | 'below'; thresholdMinor: string }; reason?: 'product' | 'direction' | 'threshold' }
/** Validate + assemble a price-alert create payload from the form (the server re-validates, zod .strict). */
export function buildAlertDraft(form: { productId?: string; regionId?: string | null; direction?: string; rupees?: string }): AlertDraft {
  const productId = (form.productId ?? '').trim();
  if (!productId) return { ok: false, reason: 'product' };
  if (form.direction !== 'above' && form.direction !== 'below') return { ok: false, reason: 'direction' };
  const thresholdMinor = rupeesToThresholdMinor(form.rupees ?? '');
  if (!thresholdMinor) return { ok: false, reason: 'threshold' };
  return { ok: true, input: { productId, regionId: form.regionId ?? null, direction: form.direction, thresholdMinor } };
}

/** Price-alert status pill: active vs paused. */
export function alertTone(a: Pick<PriceAlert, 'isActive'>): PillTone { return a.isActive ? 'success' : 'neutral'; }

/** Weather severity → tone. */
export function weatherSeverityTone(severity: string): PillTone {
  switch (severity) {
    case 'severe': case 'extreme': case 'red': return 'danger';
    case 'moderate': case 'orange': return 'warning';
    case 'minor': case 'yellow': case 'advisory': return 'info';
    default: return 'neutral';
  }
}

/** Whether a weather advisory is currently in effect (UX; the server's activeOnly filter is authoritative).
 * `now` is injectable for testing. */
export function isAdvisoryActive(a: Pick<WeatherAlert, 'validFrom' | 'validTo'>, now: number = Date.now()): boolean {
  const from = a.validFrom ? Date.parse(a.validFrom) : NaN;
  const to = a.validTo ? Date.parse(a.validTo) : NaN;
  if (!Number.isNaN(from) && now < from) return false;
  if (!Number.isNaN(to) && now > to) return false;
  return true;
}

/** Latest-vs-previous change-% for a price history series (newest-first), for the pulse trend. */
export function historyTrendPct(history: Pick<MandiPrice, 'modalMinor'>[]): number | null {
  if (!history || history.length < 2) return null;
  return priceChangePct(history[1].modalMinor, history[0].modalMinor);
}

/** Server-computed day-over-day Δ in basis points → percent rounded to 1 dp (display only). The server is the
 * authority on the actual previous day (P1-3 pulse.change); this only formats it. Null passes through. */
export function bpsToPct(bps: number | null | undefined): number | null {
  if (bps == null || !Number.isFinite(bps)) return null;
  return Math.round(bps / 10) / 10;
}

// --- forecast extended metrics (P1-4) — all inputs are real provider numbers; presentation only, no fabrication ---
/** Short hour label for an ISO time (e.g. '3 PM'); falls back to the raw string on parse failure. Pure. */
export function hourLabel(iso: string, lang: string = 'en'): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleTimeString(lang === 'en' ? 'en-IN' : lang === 'gu' ? 'gu-IN' : 'hi-IN', { hour: 'numeric' });
}
/** WHO UV-index band → i18n key suffix (`weather.uvBand.<key>`), or null when UV is unavailable (§13, never faked). */
export function uvBand(uv: number | null | undefined): 'low' | 'moderate' | 'high' | 'veryHigh' | 'extreme' | null {
  if (uv == null || !Number.isFinite(uv)) return null;
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'veryHigh';
  return 'extreme';
}
/** Wind bearing (deg) → 8-point compass code, or null when absent. Pure. */
export function windCompass(deg: number | null | undefined): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// --- forecast (P0-12) ---
/** A short weekday label for a forecast day's ISO date (e.g. 'Wed'); falls back to the raw date on parse failure. */
export function forecastDayLabel(day: Pick<ForecastDay, 'date'>): string {
  const t = Date.parse(day.date);
  return Number.isNaN(t) ? day.date : new Date(t).toLocaleDateString(undefined, { weekday: 'short' });
}
/** Compact one-line summary for a forecast day (display only; numbers come straight from the provider). */
export function forecastDaySummary(day: ForecastDay): string {
  return `${Math.round(day.tempMinC)}–${Math.round(day.tempMaxC)}°C · ${day.precipProbPct}%`;
}

/** Active/total counts for the price-alerts dashboard header. Pure. (Triggered-today / this-week counts are now
 * served by market.alertActivity — P1-3 — so the screen shows real numbers, not "—".) */
export function alertSummary(alerts: readonly Pick<PriceAlert, 'isActive'>[]): { active: number; total: number } {
  let active = 0;
  for (const a of alerts) if (a.isActive) active++;
  return { active, total: alerts.length };
}

/** Emoji for a server-normalised weather condition code (clear|clouds|fog|rain|snow|thunder|unknown). Presentation
 * only — the code is real server data; an unknown code degrades to a neutral glyph, never a guessed condition. */
export function weatherEmoji(code: string | null | undefined): string {
  switch (code) {
    case 'clear': return '☀️';
    case 'clouds': return '⛅';
    case 'fog': return '🌫️';
    case 'rain': return '🌧️';
    case 'snow': return '❄️';
    case 'thunder': return '⛈️';
    default: return '🌡️';
  }
}

/** i18n key suffix for a condition code → `weather.cond.<key>`. Pure. */
export function weatherConditionKey(code: string | null | undefined): string {
  const known = ['clear', 'clouds', 'fog', 'rain', 'snow', 'thunder'];
  return known.includes(code ?? '') ? (code as string) : 'unknown';
}

const SEVERITY_RANK: Record<string, number> = { extreme: 5, red: 5, severe: 4, orange: 4, moderate: 3, yellow: 2, minor: 1, advisory: 1 };
/** The single most-severe ACTIVE advisory to feature in the alert banner, or null. Pure (nowMs injectable). */
export function pickPrimaryAdvisory(advisories: readonly WeatherAlert[], nowMs: number = Date.now()): WeatherAlert | null {
  let best: WeatherAlert | null = null; let bestRank = -1;
  for (const a of advisories) {
    if (!isAdvisoryActive(a, nowMs)) continue;
    const rank = SEVERITY_RANK[a.severity] ?? 0;
    if (rank > bestRank) { best = a; bestRank = rank; }
  }
  return best;
}
