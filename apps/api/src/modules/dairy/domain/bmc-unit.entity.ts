// modules/dairy/domain/bmc-unit.entity.ts · PC-56 TENANT-6d-1 · the bulk milk cooler, as an aggregate.
//
// **`bmc_units` HAS HAD NO APPLICATION CODE SINCE MIGRATION 0009.** No repository, no service, no route: a cooperative
// could not register the tank its members' milk sits in for six hours, and TENANT-6a's counter board printed `no unit`
// for every centre because there was never a unit to find. This is the first code that owns one.
//
// The aggregate is small and its rules are all of the *"who said that"* kind: a band is a decision, a level is a
// report, a compressor state is somebody's word, and a retirement is an end. Nothing here computes a temperature.
import { DomainEvent, DairyEventType } from './dairy.events';
import { BmcUnitInvalidError } from './dairy.errors';
import { bandOf, Band } from './bmc';

export const COMPRESSOR_STATES = ['healthy', 'attention', 'unknown'] as const;
export type CompressorState = (typeof COMPRESSOR_STATES)[number];

export interface BmcUnitProps {
  id: string;
  tenantId: string;
  mccId: string;
  /** Deci-degrees, all three — the band this cooler is judged against (0162). */
  minDeci: number;
  targetDeci: number;
  toleranceDeci: number;
  /** Litres, scaled by 100 (the column is numeric(10,2)) so capacity and level share one unit and no float. */
  capacityCenti: bigint;
  volumeCenti: bigint | null;
  volumeAt: Date | null;
  volumeBy: string | null;
  iotDeviceRef: string | null;
  model: string | null;
  serialNo: string | null;
  compressorState: CompressorState;
  compressorStateAt: Date | null;
  compressorStateBy: string | null;
  isActive: boolean;
  retiredAt: Date | null;
  retiredBy: string | null;
  createdAt?: Date;
}

export class BmcUnit {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: BmcUnitProps) {}

  static register(input: Omit<BmcUnitProps, 'volumeCenti' | 'volumeAt' | 'volumeBy' | 'compressorState' | 'compressorStateAt' | 'compressorStateBy' | 'isActive' | 'retiredAt' | 'retiredBy'>): BmcUnit {
    assertBand(input.minDeci, input.targetDeci, input.toleranceDeci);
    if (input.capacityCenti <= 0n) throw new BmcUnitInvalidError('a cooler with no capacity is not a cooler');
    const u = new BmcUnit({
      ...input,
      volumeCenti: null, volumeAt: null, volumeBy: null,
      // `unknown` on day one, and it stays unknown until a human says otherwise: nothing on this platform senses a
      // compressor, so a fresh unit must not present as healthy simply because nobody has complained yet.
      compressorState: 'unknown', compressorStateAt: null, compressorStateBy: null,
      isActive: true, retiredAt: null, retiredBy: null,
    });
    u.events.push({
      type: DairyEventType.BmcRegistered,
      payload: {
        unitId: u.props.id, mccId: u.props.mccId, deviceRef: u.props.iotDeviceRef,
        targetDeci: u.props.targetDeci, toleranceDeci: u.props.toleranceDeci,
      },
    });
    return u;
  }
  static rehydrate(props: BmcUnitProps): BmcUnit { return new BmcUnit(props); }

  get id() { return this.props.id; }
  get mccId() { return this.props.mccId; }
  get isActive() { return this.props.isActive; }
  get deviceRef() { return this.props.iotDeviceRef; }
  band(): Band { return bandOf(this.props); }
  toProps(): Readonly<BmcUnitProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /**
   * Move the band. A cooperative that changes what "cold enough" means is making a real decision, so it is an EVENT
   * — and it does not rewrite history: readings already written keep the `is_breach` they were judged with, because
   * that is what the operator was told at the time.
   */
  setBand(minDeci: number, targetDeci: number, toleranceDeci: number, byUserId: string): void {
    this.assertLive();
    assertBand(minDeci, targetDeci, toleranceDeci);
    const before = { minDeci: this.props.minDeci, targetDeci: this.props.targetDeci, toleranceDeci: this.props.toleranceDeci };
    this.props.minDeci = minDeci;
    this.props.targetDeci = targetDeci;
    this.props.toleranceDeci = toleranceDeci;
    this.events.push({
      type: DairyEventType.BmcBandChanged,
      payload: { unitId: this.props.id, mccId: this.props.mccId, before, after: { minDeci, targetDeci, toleranceDeci }, byUserId },
    });
  }

  /** How full it is now, and who says so. A level above the tank's capacity is a bad reading, refused. */
  reportLevel(volumeCenti: bigint, at: Date, byUserId: string | null): void {
    this.assertLive();
    if (volumeCenti < 0n) throw new BmcUnitInvalidError('a tank cannot hold a negative volume');
    if (volumeCenti > this.props.capacityCenti) {
      throw new BmcUnitInvalidError('a level above the tank\'s capacity is a faulty reading, not a full tank');
    }
    this.props.volumeCenti = volumeCenti;
    this.props.volumeAt = at;
    this.props.volumeBy = byUserId;
  }

  /**
   * Somebody's word about the machine.
   *
   * `unknown` is allowed BACK — an operator who no longer stands behind last week's "healthy" must be able to say so,
   * and the alternative is a screen that keeps quoting a statement nobody will repeat.
   */
  stateCompressor(state: CompressorState, at: Date, byUserId: string): void {
    this.assertLive();
    if (!COMPRESSOR_STATES.includes(state)) throw new BmcUnitInvalidError(`unknown compressor state '${state}'`);
    this.props.compressorState = state;
    // `unknown` carries its stamp too. The database allows a bare `unknown` (0162) because that is the state of a
    // cooler nobody has spoken about; once somebody HAS, the record says when and who even to withdraw a claim.
    this.props.compressorStateAt = at;
    this.props.compressorStateBy = byUserId;
    this.events.push({
      type: DairyEventType.BmcCompressorStated,
      payload: { unitId: this.props.id, mccId: this.props.mccId, state, byUserId },
    });
  }

  /** The cooler is gone. Monitoring stops; the readings it produced stay exactly where they are. */
  retire(at: Date, byUserId: string): void {
    if (!this.props.isActive) throw new BmcUnitInvalidError('this cooler has already been retired');
    this.props.isActive = false;
    this.props.retiredAt = at;
    this.props.retiredBy = byUserId;
    this.events.push({
      type: DairyEventType.BmcRetired,
      payload: { unitId: this.props.id, mccId: this.props.mccId, deviceRef: this.props.iotDeviceRef, byUserId },
    });
  }

  /**
   * A retired cooler accepts nothing — not a band, not a level, not a compressor note.
   *
   * Which is also why the reading path checks it: a sensor left plugged in on a tank that was sold would otherwise go
   * on filling a chart nobody is watching, and every hour of it would look like a working cooler.
   */
  private assertLive(): void {
    if (!this.props.isActive) throw new BmcUnitInvalidError('this cooler has been retired');
  }

  toJSON() {
    const v = this.props;
    return {
      id: v.id, mccId: v.mccId, minDeci: v.minDeci, targetDeci: v.targetDeci, toleranceDeci: v.toleranceDeci,
      capacityCenti: v.capacityCenti.toString(), volumeCenti: v.volumeCenti === null ? null : v.volumeCenti.toString(),
      volumeAt: v.volumeAt, volumeBy: v.volumeBy, iotDeviceRef: v.iotDeviceRef, model: v.model, serialNo: v.serialNo,
      compressorState: v.compressorState, compressorStateAt: v.compressorStateAt, compressorStateBy: v.compressorStateBy,
      isActive: v.isActive, retiredAt: v.retiredAt, createdAt: v.createdAt,
    };
  }
}

/** The band rule, in one place: the same one 0162's `ck_bmc_band` enforces, so the aggregate and the database agree. */
function assertBand(minDeci: number, targetDeci: number, toleranceDeci: number): void {
  for (const [name, v] of [['min', minDeci], ['target', targetDeci], ['tolerance', toleranceDeci]] as const) {
    if (!Number.isInteger(v)) throw new BmcUnitInvalidError(`${name} temperature must be a whole number of tenths of a degree`);
  }
  if (targetDeci < minDeci) throw new BmcUnitInvalidError('the target cannot be colder than the floor — every reading would be a breach');
  if (targetDeci < -20 || targetDeci > 150) throw new BmcUnitInvalidError('target out of range for a milk cooler');
  if (minDeci < -50 || minDeci > 100) throw new BmcUnitInvalidError('floor out of range for a milk cooler');
  if (toleranceDeci < 0 || toleranceDeci > 50) throw new BmcUnitInvalidError('tolerance must be between 0.0 and 5.0 degrees');
}
