// modules/dairy/services/bmc-reading.service.ts · PC-56 TENANT-6d-1 · the temperature stream W167 has drawn since 6a.
//
// **NO COLD-CHAIN READING HAS EVER BEEN WRITTEN FOR A `bmc_unit` SUBJECT.** The column exists (0007), the subject value
// is legal, the counter board reads it — and there has never been a door for a cooler's sensor to come through. This is
// that door, and where it is placed matters more than what it does:
//
//   • **the band comes from the TANK, not the caller.** `ColdChainService.record` takes `allowedMinC/allowedMaxC` from
//     its DTO, which is right for a reefer whose cargo decides the band and wrong for a cooler whose band is a
//     cooperative's standing decision (0162). A stream that supplies its own band never breaches, and the operator's
//     phone stays quiet while the milk goes off.
//   • **the permission is the DAIRY's.** `record` demands `logistics.manage`; a dairy secretary is not a fleet manager.
//     Requiring the fleet permission to write your own cooperative's tank temperature is a permission granted to the
//     wrong role — and the practical result would be that nobody at the cooperative could switch the stream on.
//   • **the write still belongs to logistics.** One writer of `cold_chain_logs`, one `is_breach` rule: this service
//     resolves the band and calls `ColdChainService.appendForOwner`, the public seam that exists for exactly this
//     (CLAUDE.md: no module imports another module's repositories).
//
// AND IT REFUSES RATHER THAN GUESSES. A reading for an unknown sensor, or for a cooler that was retired, is REFUSED
// with the reason — because the alternative is a table quietly filling with numbers about a tank that was sold, which
// looks exactly like a working cooler until somebody's milk spoils.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { numericFromScaled } from '../../../core/database/pg-numeric';
import { ColdChainService } from '../../logistics/services/cold-chain.service';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { BmcReadingRefusedError, BmcUnitNotFoundError, DairyForbiddenError } from '../domain/dairy.errors';
import { bandOf, deciOfC, isBreach, readingVerdict } from '../domain/bmc';
import { DairyActor } from './mcc-centre.service';

export interface BmcReadingInput {
  /** Either the sensor's own reference (how a device identifies itself) or the unit id (how an operator does). */
  deviceRef?: string | null;
  unitId?: string | null;
  tempC: string;
  humidityPct?: string | null;
  /** The sensor's own timestamp. Buffered readings arrive late and must keep the time they were TAKEN. */
  recordedAt?: string | null;
}

@Injectable()
export class BmcReadingService {
  private readonly log = new Logger(BmcReadingService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly units: BmcUnitRepository,
    @Inject(ColdChainService) private readonly coldChain: ColdChainService,
  ) {}

  /**
   * Record one reading against the tank's own band.
   *
   * `dairy.manage` — the cooperative's desk, or a device acting with its credentials. The reading is written through
   * logistics' public service so `is_breach` is computed by the one implementation that owns it, and the verdict comes
   * back so the caller (a counter tablet, a gateway) can show the operator what the platform just decided.
   */
  async record(tenantId: string, actor: DairyActor, input: BmcReadingInput) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return timed(this.metrics, 'dairy.bmc_reading', { tenant: tenantId }, async () => {
      const unit = await this.resolve(tenantId, input);
      const p = unit.toProps();

      // A RETIRED cooler is refused, loudly. A sensor still reporting from one is the most likely cause of a chart
      // nobody can explain, and the fix is physical: move the sensor, or register the new tank.
      if (!p.isActive) {
        throw new BmcReadingRefusedError('this cooler has been retired — a sensor still reporting on it is a sensor on the wrong tank', { unitId: p.id });
      }

      const tempDeci = deciOfC(input.tempC);
      const band = bandOf(p);
      const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
      if (Number.isNaN(recordedAt.getTime())) throw new BmcReadingRefusedError('unreadable reading timestamp');

      // THE ONE PLACE THIS PATH TOUCHES A FLOAT, and it is at the boundary of another module's decision.
      // `ColdChainLog.record` has taken JS numbers since PC-54 (its column is `numeric(5,2)`), so the seam speaks
      // numbers. Converting HERE, from tenths, is the safe direction: a one-decimal value and its band both convert to
      // the same nearest double, so `tempC < min || tempC > max` compares exactly at the boundary — 4.5 against a band
      // ending at 4.5 is in range, which is the case W170's own numbers land on. Everything before this line and the
      // verdict after it are integers.
      const written = await this.coldChain.appendForOwner(tenantId, {
        subjectType: 'bmc_unit', subjectId: p.id,
        tempC: tempDeci / 10,
        humidityPct: input.humidityPct == null ? null : Number(input.humidityPct),
        deviceRef: p.iotDeviceRef,
        recordedAt,
        // THE TANK'S BAND, at each end, so the row records what it was judged against — a later change to the
        // cooperative's band cannot retro-judge a reading an operator already acted on.
        allowedMinC: band.minDeci / 10,
        allowedMaxC: band.maxDeci / 10,
        byUserId: actor.userId,
      });

      const verdict = readingVerdict(tempDeci, band);
      // The two must agree: logistics computed `is_breach` from the band we passed, and this module's own arithmetic
      // says the same thing. If they ever disagree, the reading is stored and the disagreement is LOUD rather than
      // averaged away — two implementations of one rule is how a screen and an alert come to contradict each other.
      if (written.isBreach !== isBreach(tempDeci, band)) {
        this.log.error(`bmc reading ${written.id} on unit ${p.id}: is_breach=${written.isBreach} from the ledger but ${isBreach(tempDeci, band)} from the band ${band.minDeci}..${band.maxDeci} (deci) — the two breach rules have drifted`);
        this.metrics.inc('dairy.bmc_breach_rule_drift', { tenant: tenantId });
      }

      return {
        id: written.id, unitId: p.id,
        // Back to a STRING for the wire, from the integer this module held all along — never from the float above.
        tempC: numericFromScaled(BigInt(tempDeci), 1),
        isBreach: written.isBreach, verdict, recordedAt: written.recordedAt,
        band: { minC: numericFromScaled(BigInt(band.minDeci), 1), maxC: numericFromScaled(BigInt(band.maxDeci), 1) },
      };
    });
  }

  /**
   * Which tank this is about.
   *
   * A device knows its own reference and nothing else, so `deviceRef` is the primary path — and an unknown reference is
   * REFUSED, never stored under a guess. Exactly one of the two identifiers is required: accepting both and preferring
   * one silently is how a gateway sends the right sensor's number about the wrong tank.
   */
  private async resolve(tenantId: string, input: BmcReadingInput) {
    const hasRef = typeof input.deviceRef === 'string' && input.deviceRef.trim().length > 0;
    const hasId = typeof input.unitId === 'string' && input.unitId.trim().length > 0;
    if (hasRef === hasId) {
      throw new BmcReadingRefusedError('a reading must name exactly one of deviceRef or unitId');
    }
    const unit = await this.uow.run(tenantId, (tx) => (hasRef
      ? this.units.byDeviceRef(tx, tenantId, (input.deviceRef as string).trim())
      : this.units.byId(tx, tenantId, (input.unitId as string).trim())));
    if (!unit) {
      if (hasRef) {
        // Named, not swallowed: a sensor nobody registered is a cooler nobody is watching.
        throw new BmcReadingRefusedError('no cooler is registered against this sensor reference', { deviceRef: input.deviceRef });
      }
      throw new BmcUnitNotFoundError(String(input.unitId));
    }
    return unit;
  }
}
