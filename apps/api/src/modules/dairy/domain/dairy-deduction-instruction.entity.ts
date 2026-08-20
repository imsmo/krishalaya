// modules/dairy/domain/dairy-deduction-instruction.entity.ts · PC-56 TENANT-6c-5 · the member's arrangement.
//
// W169: *"Deductions above 25% of gross need the member's fresh consent, **not just standing instructions**."* This is
// the standing instruction that sentence contrasts against — and it exists so that "the cycle deducted it
// automatically" can mean "the family arranged this", rather than "the software took what it found".
import { DomainEvent, DairyEventType } from './dairy.events';
import { DeductionInstructionInvalidError } from './dairy.errors';

export type DeductionChannel = 'app' | 'web' | 'ambassador_assisted' | 'ivr';
export const DEDUCTION_CHANNELS: readonly DeductionChannel[] = ['app', 'web', 'ambassador_assisted', 'ivr'];

export interface DeductionInstructionProps {
  id: string;
  tenantId: string;
  membershipId: string;
  typeId: string;
  /** Denormalised from the vocabulary for readability; `typeId` is the truth. */
  typeCode: string;
  /** NULL = every source of this type. Set = one receivable, which is how an instalment on one debt is expressed. */
  sourceId: string | null;
  maxPerCycleMinor: bigint | null;
  authorisedBy: string;
  authorisedAt: Date;
  channel: DeductionChannel;
  assistedBy: string | null;
  recordedBy: string;
  note: string | null;
  isActive: boolean;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdAt?: Date;
}

export class DairyDeductionInstruction {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: DeductionInstructionProps) {}

  static authorise(input: Omit<DeductionInstructionProps, 'isActive' | 'revokedAt' | 'revokedBy'>): DairyDeductionInstruction {
    if (!DEDUCTION_CHANNELS.includes(input.channel)) throw new DeductionInstructionInvalidError(`unknown channel '${input.channel}'`);
    // An ambassador SITTING WITH the member is supported; an ambassador acting on their behalf is not modelled at all
    // (0161's header says so), so an assisted arrangement must name who assisted and an unassisted one must not claim
    // somebody did.
    if ((input.channel === 'ambassador_assisted') !== (input.assistedBy !== null)) {
      throw new DeductionInstructionInvalidError('an ambassador-assisted arrangement must name the ambassador, and only that channel may');
    }
    if (input.maxPerCycleMinor !== null && input.maxPerCycleMinor <= 0n) {
      // Zero would be an arrangement to deduct nothing, which is a REVOCATION wearing an instalment's clothes — and
      // it would sit in the table looking active while the assembler skipped it for ever.
      throw new DeductionInstructionInvalidError('an instalment must be greater than zero — to stop a recovery, revoke the arrangement');
    }
    const i = new DairyDeductionInstruction({ ...input, isActive: true, revokedAt: null, revokedBy: null });
    i.events.push({
      type: DairyEventType.DeductionInstructionAuthorised,
      payload: {
        // The MEMBER is the recipient: this is an arrangement about their future money and the one thing they must be
        // told is that it now exists. ADMIN-6b's finding, six waves running — a map row over a payload with no
        // recipient sends nothing.
        userId: input.authorisedBy,
        instructionId: i.props.id, membershipId: i.props.membershipId, typeCode: i.props.typeCode,
        sourceId: i.props.sourceId, channel: i.props.channel,
        maxPerCycleMinor: i.props.maxPerCycleMinor === null ? null : i.props.maxPerCycleMinor.toString(),
      },
    });
    return i;
  }
  static rehydrate(props: DeductionInstructionProps): DairyDeductionInstruction { return new DairyDeductionInstruction(props); }

  get id() { return this.props.id; }
  get membershipId() { return this.props.membershipId; }
  get typeId() { return this.props.typeId; }
  get typeCode() { return this.props.typeCode; }
  get sourceId() { return this.props.sourceId; }
  get maxPerCycleMinor() { return this.props.maxPerCycleMinor; }
  get isActive() { return this.props.isActive; }
  get authorisedBy() { return this.props.authorisedBy; }
  toProps(): Readonly<DeductionInstructionProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /**
   * End it. Either side may: the member changing their mind, or the desk closing an arrangement whose debt is gone.
   *
   * The arrangement itself is never edited — the table's grants allow only this transition — so the history says what
   * was true in July when somebody asks in December. Changing an instalment is a revocation and a new row.
   */
  revoke(at: Date, byUserId: string): void {
    if (!this.props.isActive) throw new DeductionInstructionInvalidError('this arrangement has already ended');
    this.props.isActive = false;
    this.props.revokedAt = at;
    this.props.revokedBy = byUserId;
    this.events.push({
      type: DairyEventType.DeductionInstructionRevoked,
      payload: {
        userId: this.props.authorisedBy,
        instructionId: this.props.id, membershipId: this.props.membershipId, typeCode: this.props.typeCode,
        sourceId: this.props.sourceId, revokedBy: byUserId,
      },
    });
  }

  /** Does this arrangement authorise recovering THIS source? */
  covers(typeId: string, sourceId: string): boolean {
    if (!this.props.isActive || this.props.typeId !== typeId) return false;
    return this.props.sourceId === null || this.props.sourceId === sourceId;
  }

  toJSON() {
    const v = this.props;
    return { id: v.id, membershipId: v.membershipId, typeCode: v.typeCode, sourceId: v.sourceId,
      maxPerCycleMinor: v.maxPerCycleMinor === null ? null : v.maxPerCycleMinor.toString(),
      authorisedBy: v.authorisedBy, authorisedAt: v.authorisedAt, channel: v.channel, assistedBy: v.assistedBy,
      note: v.note, isActive: v.isActive, revokedAt: v.revokedAt, createdAt: v.createdAt };
  }
}
