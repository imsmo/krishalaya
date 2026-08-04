// Unit tests for the PURE mandi-price + weather logic (features/market/market). No React/native deps (SDK/ui types
// are type-only). Money is bigint minor strings (Law 2) — change-% / threshold use BigInt; the server stays the
// authority on prices, alert firing and advisories.
import {
  priceChangePct, changeTone, changeArrow, rupeesToThresholdMinor, buildAlertDraft,
  alertTone, weatherSeverityTone, isAdvisoryActive, historyTrendPct,
  weatherEmoji, weatherConditionKey, pickPrimaryAdvisory, alertSummary, bpsToPct, uvBand, windCompass,
} from '../../features/market/market';
import type { MandiPrice, WeatherAlert } from '@krishalaya/sdk-js';

describe('uvBand', () => {
  it('maps WHO UV bands; null when absent', () => {
    expect(uvBand(0)).toBe('low');
    expect(uvBand(2.9)).toBe('low');
    expect(uvBand(3)).toBe('moderate');
    expect(uvBand(6)).toBe('high');
    expect(uvBand(8)).toBe('veryHigh');
    expect(uvBand(11)).toBe('extreme');
    expect(uvBand(null)).toBeNull();
    expect(uvBand(undefined)).toBeNull();
  });
});

describe('windCompass', () => {
  it('maps bearing to 8-point compass; wraps; null when absent', () => {
    expect(windCompass(0)).toBe('N');
    expect(windCompass(45)).toBe('NE');
    expect(windCompass(90)).toBe('E');
    expect(windCompass(200)).toBe('S');
    expect(windCompass(360)).toBe('N');
    expect(windCompass(-45)).toBe('NW');
    expect(windCompass(null)).toBeNull();
  });
});

describe('bpsToPct', () => {
  it('converts server basis points to a 1dp percent; null passes through', () => {
    expect(bpsToPct(250)).toBe(2.5);
    expect(bpsToPct(-1234)).toBe(-12.3);
    expect(bpsToPct(0)).toBe(0);
    expect(bpsToPct(null)).toBeNull();
    expect(bpsToPct(undefined)).toBeNull();
  });
});

describe('alertSummary', () => {
  it('counts active and total (triggered counts now served by alertActivity, P1-3)', () => {
    expect(alertSummary([{ isActive: true }, { isActive: false }, { isActive: true }])).toEqual({ active: 2, total: 3 });
    expect(alertSummary([])).toEqual({ active: 0, total: 0 });
  });
});

describe('weatherEmoji / weatherConditionKey', () => {
  it('maps the normalised codes; unknown degrades (never guessed)', () => {
    expect(weatherEmoji('rain')).toBe('🌧️');
    expect(weatherEmoji('thunder')).toBe('⛈️');
    expect(weatherEmoji('mystery')).toBe('🌡️');
    expect(weatherConditionKey('clouds')).toBe('clouds');
    expect(weatherConditionKey('mystery')).toBe('unknown');
    expect(weatherConditionKey(null)).toBe('unknown');
  });
});

describe('pickPrimaryAdvisory', () => {
  const mk = (id: string, severity: string, validTo: string | null): WeatherAlert => ({
    id, regionId: 'r1', alertTypeId: null, severity, validFrom: null, validTo, advisoryTextKey: 'k', payload: null, source: null,
  });
  const now = Date.UTC(2026, 7, 15);
  it('returns the most-severe ACTIVE advisory; null when none active', () => {
    const future = new Date(now + 86_400_000).toISOString();
    const past = new Date(now - 86_400_000).toISOString();
    const chosen = pickPrimaryAdvisory([mk('a', 'minor', future), mk('b', 'severe', future), mk('c', 'extreme', past)], now);
    expect(chosen?.id).toBe('b'); // 'c' (extreme) is expired → excluded
    expect(pickPrimaryAdvisory([mk('x', 'severe', past)], now)).toBeNull();
  });
});

describe('priceChangePct', () => {
  it('computes 1dp percent change with BigInt (no float drift on large paise)', () => {
    expect(priceChangePct('100000', '110000')).toBe(10);   // +10%
    expect(priceChangePct('100000', '95000')).toBe(-5);     // -5%
    expect(priceChangePct('100000', '100000')).toBe(0);
    expect(priceChangePct('300000', '310000')).toBeCloseTo(3.3, 5); // 3.33% → 3.3
  });
  it('returns null on missing / zero / malformed input', () => {
    expect(priceChangePct(null, '100')).toBeNull();
    expect(priceChangePct('100', undefined)).toBeNull();
    expect(priceChangePct('0', '100')).toBeNull();
    expect(priceChangePct('abc', '100')).toBeNull();
  });
});

describe('changeTone / changeArrow', () => {
  it('maps direction → tone/arrow', () => {
    expect(changeTone(5)).toBe('success');
    expect(changeTone(-5)).toBe('danger');
    expect(changeTone(0)).toBe('neutral');
    expect(changeTone(null)).toBe('neutral');
    expect(changeArrow(5)).toBe('▲');
    expect(changeArrow(-5)).toBe('▼');
    expect(changeArrow(0)).toBe('—');
    expect(changeArrow(null)).toBe('—');
  });
});

describe('rupeesToThresholdMinor', () => {
  it('converts whole rupees → paise minor string', () => {
    expect(rupeesToThresholdMinor('100')).toBe('10000');
    expect(rupeesToThresholdMinor(' 250 ')).toBe('25000');
  });
  it('rejects zero / non-numeric / empty / too-long', () => {
    expect(rupeesToThresholdMinor('0')).toBeUndefined();
    expect(rupeesToThresholdMinor('')).toBeUndefined();
    expect(rupeesToThresholdMinor('12.5')).toBeUndefined();
    expect(rupeesToThresholdMinor('-5')).toBeUndefined();
    expect(rupeesToThresholdMinor('12345678901234')).toBeUndefined();
  });
});

describe('buildAlertDraft', () => {
  it('assembles a valid create payload', () => {
    const d = buildAlertDraft({ productId: 'p1', regionId: 'r1', direction: 'above', rupees: '100' });
    expect(d.ok).toBe(true);
    expect(d.input).toEqual({ productId: 'p1', regionId: 'r1', direction: 'above', thresholdMinor: '10000' });
  });
  it('defaults regionId to null when absent', () => {
    const d = buildAlertDraft({ productId: 'p1', direction: 'below', rupees: '50' });
    expect(d.ok).toBe(true);
    expect(d.input?.regionId).toBeNull();
  });
  it('rejects with a typed reason', () => {
    expect(buildAlertDraft({ direction: 'above', rupees: '100' }).reason).toBe('product');
    expect(buildAlertDraft({ productId: 'p1', direction: 'sideways', rupees: '100' }).reason).toBe('direction');
    expect(buildAlertDraft({ productId: 'p1', direction: 'above', rupees: '0' }).reason).toBe('threshold');
  });
});

describe('alertTone', () => {
  it('active→success, paused→neutral', () => {
    expect(alertTone({ isActive: true })).toBe('success');
    expect(alertTone({ isActive: false })).toBe('neutral');
  });
});

describe('weatherSeverityTone', () => {
  it('maps severity buckets → tone', () => {
    expect(weatherSeverityTone('severe')).toBe('danger');
    expect(weatherSeverityTone('red')).toBe('danger');
    expect(weatherSeverityTone('moderate')).toBe('warning');
    expect(weatherSeverityTone('orange')).toBe('warning');
    expect(weatherSeverityTone('minor')).toBe('info');
    expect(weatherSeverityTone('advisory')).toBe('info');
    expect(weatherSeverityTone('whatever')).toBe('neutral');
  });
});

describe('isAdvisoryActive', () => {
  const now = Date.parse('2026-06-21T12:00:00Z');
  const a = (over: Partial<Pick<WeatherAlert, 'validFrom' | 'validTo'>>) => over;
  it('true within window, false before/after', () => {
    expect(isAdvisoryActive(a({ validFrom: '2026-06-20T00:00:00Z', validTo: '2026-06-22T00:00:00Z' }), now)).toBe(true);
    expect(isAdvisoryActive(a({ validFrom: '2026-06-22T00:00:00Z' }), now)).toBe(false);
    expect(isAdvisoryActive(a({ validTo: '2026-06-20T00:00:00Z' }), now)).toBe(false);
  });
  it('treats missing/unparseable bounds as open', () => {
    expect(isAdvisoryActive(a({}), now)).toBe(true);
    expect(isAdvisoryActive(a({ validFrom: 'nope', validTo: 'nope' }), now)).toBe(true);
  });
});

describe('historyTrendPct', () => {
  const p = (modalMinor: string): Pick<MandiPrice, 'modalMinor'> => ({ modalMinor });
  it('latest vs previous (newest-first)', () => {
    expect(historyTrendPct([p('110000'), p('100000')])).toBe(10);
  });
  it('null when fewer than two points', () => {
    expect(historyTrendPct([p('100000')])).toBeNull();
    expect(historyTrendPct([])).toBeNull();
  });
});
