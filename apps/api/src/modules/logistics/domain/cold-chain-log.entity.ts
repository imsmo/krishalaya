// modules/logistics/domain/cold-chain-log.entity.ts · an immutable reefer/vaccine temperature reading
// (0007 cold_chain_logs, PRD §24.9/§18.12). APPEND-ONLY telemetry (DB REVOKEs UPDATE/DELETE; partitioned by
// recorded_at, bigserial id assigned by the DB). Pure TS. Temperatures are physical measurements (decimal), not money.
//
// PC-56 TENANT-SW-e · F-13 — THE BAND IS THE SERVER'S. A reading used to carry its own allowed band and timestamp from the
// caller, so `allowedMaxC: 80` meant "never a breach" and a past `recordedAt` rewrote history. Now:
//   • the band is COPIED by the database from `cold_chain_thresholds` at write (trg_ccl_before) — this entity never sees one;
//   • a MANUAL reading is recorded at the server's own time; a DEVICE reading keeps the device's time (buffered readings) beside
//     the server's time of record, and arrives only signed on the device ingest route;
//   • `is_breach` on a row means THIS reading is outside the copied band (an excursion); a BREACH is 2 consecutive device readings
//     outside the band (cold_chain_breaches, opened by the database in the same transaction).
// So this entity validates what a person may type for a manual reading, and `excursion` mirrors the database's rule for display.
import { InvalidColdChainReadingError } from './logistics.errors';

export const COLD_CHAIN_SUBJECTS = ['shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box'] as const;
export type ColdChainSubject = (typeof COLD_CHAIN_SUBJECTS)[number];
export const READING_SOURCES = ['device', 'manual'] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

const TEMP_MIN = -60;   // sane sensor envelope (°C) — reject obviously bogus readings
const TEMP_MAX = 80;
const HUM_MIN = 0;
const HUM_MAX = 100;

export interface ManualReadingInput {
  tenantId: string; subjectType: ColdChainSubject | string; subjectId: string;
  tempC: number; humidityPct?: number | null; deviceRef?: string | null;
}
export interface ColdChainLogProps {
  id: string | null; tenantId: string | null; subjectType: string; subjectId: string;
  tempC: number; humidityPct: number | null; deviceRef: string | null; recordedAt: Date | null; isBreach: boolean;
  source?: ReadingSource; deviceId?: string | null; serverRecordedAt?: Date | null; bandMinC?: number | null; bandMaxC?: number | null;
  sequenceNo?: string | null; recordedUs?: string | null;
}

export function num(v: number, lo: number, hi: number, label: string): number {
  if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) throw new InvalidColdChainReadingError(`${label} must be a finite number`);
  if (v < lo || v > hi) throw new InvalidColdChainReadingError(`${label} out of range [${lo},${hi}]`);
  return v;
}
export const assertTemp = (t: number) => num(t, TEMP_MIN, TEMP_MAX, 'temp_c');

/** The database's rule, for display: outside [min, max] of the band copied at write; no band → cannot be judged. */
export function excursion(tempC: number, band: { minC: number; maxC: number } | null): boolean | null {
  if (!band) return null;
  return tempC < band.minC || tempC > band.maxC;
}

export class ColdChainLog {
  private constructor(private p: ColdChainLogProps) {}

  /** A MANUAL reading as a person may type it: subject, temperature, humidity, an optional device label. No band, no time. */
  static manual(input: ManualReadingInput): ColdChainLog {
    if (!(COLD_CHAIN_SUBJECTS as readonly string[]).includes(input.subjectType)) throw new InvalidColdChainReadingError(`subject_type must be one of ${COLD_CHAIN_SUBJECTS.join('|')}`);
    const tempC = assertTemp(input.tempC);
    const humidityPct = input.humidityPct == null ? null : num(input.humidityPct, HUM_MIN, HUM_MAX, 'humidity_pct');
    return new ColdChainLog({
      id: null, tenantId: input.tenantId, subjectType: input.subjectType, subjectId: input.subjectId, tempC, humidityPct,
      deviceRef: input.deviceRef ?? null, recordedAt: null, isBreach: false, source: 'manual', deviceId: null,
    });
  }
  static rehydrate(p: ColdChainLogProps): ColdChainLog { return new ColdChainLog(p); }

  get isBreach() { return this.p.isBreach; }
  toProps(): Readonly<ColdChainLogProps> { return Object.freeze({ ...this.p }); }
}
