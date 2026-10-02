// modules/ambassadors/domain/ambassador-profile.entity.ts · the ambassador_profiles aggregate.
// One profile per user (UNIQUE user_id). Enrolled by an admin (Law 11 — being an ambassador is not self-grant).
// monthly_stipend_minor is bigint minor units (Law 2). No version column → repo locks FOR UPDATE on mutation.
import { DomainEvent, AmbassadorEventType } from './ambassadors.events';

export interface AmbassadorProfileProps {
  id: string; userId: string; tenantId: string; clusterRegionIds: string[]; tierId: string | null; mentorAmbassadorId: string | null;
  trainingCompletedAt: Date | null; kioskEnabled: boolean; aepsEnabled: boolean; monthlyStipendMinor: bigint;
  lastActivityAt: Date | null; isActive: boolean; createdAt?: Date;
  /** PC-56 TENANT-10a · F-17: `created_at::text` (microseconds) — the list cursor is minted from it. */
  createdAtRaw?: string;
}

/** PC-56 TENANT-10a · F-12: the fields an edit can change, as the audit row's before/after (money as minor strings). */
export const EDITABLE_PROFILE_FIELDS = ['clusterRegionIds', 'tierId', 'mentorAmbassadorId', 'kioskEnabled', 'aepsEnabled', 'monthlyStipendMinor', 'trainingCompletedAt'] as const;
export class AmbassadorProfile {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: AmbassadorProfileProps) {}

  static enroll(input: Omit<AmbassadorProfileProps, 'isActive' | 'lastActivityAt'>): AmbassadorProfile {
    const a = new AmbassadorProfile({ ...input, isActive: true, lastActivityAt: null });
    a.events.push({ type: AmbassadorEventType.AmbassadorEnrolled, payload: { ambassadorId: a.props.id, userId: a.props.userId } });
    return a;
  }
  static rehydrate(p: AmbassadorProfileProps): AmbassadorProfile { return new AmbassadorProfile(p); }
  get id() { return this.props.id; }
  get userId() { return this.props.userId; }
  get tenantId() { return this.props.tenantId; }
  get isActive() { return this.props.isActive; }
  toProps(): Readonly<AmbassadorProfileProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  update(patch: Partial<Pick<AmbassadorProfileProps, 'clusterRegionIds' | 'tierId' | 'mentorAmbassadorId' | 'kioskEnabled' | 'aepsEnabled' | 'monthlyStipendMinor' | 'trainingCompletedAt'>>): void {
    for (const [k, v] of Object.entries(patch)) { if (v !== undefined) (this.props as any)[k] = v; }
  }
  suspend(): void { if (!this.props.isActive) return; this.props.isActive = false; this.events.push({ type: AmbassadorEventType.AmbassadorSuspended, payload: { ambassadorId: this.props.id } }); }
  reinstate(): void { this.props.isActive = true; }
  touch(): void { this.props.lastActivityAt = new Date(); }
  /** PURE: the editable fields as plain JSON — the audit row's `before` / `after` (F-12). */
  editableSnapshot(): Record<string, unknown> {
    const v = this.props;
    return { clusterRegionIds: [...v.clusterRegionIds], tierId: v.tierId, mentorAmbassadorId: v.mentorAmbassadorId, kioskEnabled: v.kioskEnabled,
      aepsEnabled: v.aepsEnabled, monthlyStipendMinor: v.monthlyStipendMinor.toString(),
      trainingCompletedAt: v.trainingCompletedAt ? new Date(v.trainingCompletedAt).toISOString() : null };
  }
  toJSON() {
    const v = this.props;
    return { id: v.id, userId: v.userId, clusterRegionIds: v.clusterRegionIds, tierId: v.tierId, mentorAmbassadorId: v.mentorAmbassadorId,
      trainingCompletedAt: v.trainingCompletedAt, kioskEnabled: v.kioskEnabled, aepsEnabled: v.aepsEnabled, monthlyStipendMinor: v.monthlyStipendMinor.toString(),
      lastActivityAt: v.lastActivityAt, isActive: v.isActive, createdAt: v.createdAt };
  }
}
