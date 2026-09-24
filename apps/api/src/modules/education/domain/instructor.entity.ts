// modules/education/domain/instructor.entity.ts · the instructors aggregate. royalty_bps = the instructor's
// revenue share in basis points (default 8000 = 80% per the Revenue Playbook). Platform-scoped instructors
// (tenant_id NULL, e.g. KVK) are created only via admin (Law 11) — never through the tenant API.
//
// PC-56 TENANT-7d — THE INSTRUCTOR. Migration 0173 gave the row what W419 describes: a display name (7a printed a note
// where the name should be), the languages taught (codes from the platform registry), a visibility the instructor
// chooses, and the VERIFICATION as a fact with a checker and an instant — `is_verified` had been INSERTed `false` since
// 0012 and written by nothing. `verify` and `unverify` are the desk's acts (maker ≠ checker is the caller's rule AND
// 0173's trigger); this entity only performs them.
import { InvalidRoyaltyError, InvalidCourseError } from './education.errors';

export type InstructorVisibility = 'public' | 'private';
export const INSTRUCTOR_VISIBILITIES = ['public', 'private'] as const;

export interface InstructorProps {
  id: string; userId: string; tenantId: string | null; bio: string | null; royaltyBps: number; isVerified: boolean; createdAt?: Date;
  /* 0173 */
  displayName: string | null; languages: string[]; visibility: InstructorVisibility;
  verifiedAt: Date | null; verifiedBy: string | null; verificationNote: string | null;
}
export interface InstructorProfilePatch { displayName?: string | null; bio?: string | null; languages?: string[]; visibility?: InstructorVisibility }

export class Instructor {
  private constructor(private props: InstructorProps) {}
  static create(input: Pick<InstructorProps, 'id' | 'userId' | 'tenantId' | 'bio'> & Partial<Pick<InstructorProps, 'royaltyBps' | 'displayName' | 'languages' | 'visibility'>>): Instructor {
    const bps = input.royaltyBps ?? 8000;
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new InvalidRoyaltyError(bps);
    return new Instructor({
      id: input.id, userId: input.userId, tenantId: input.tenantId, bio: input.bio, royaltyBps: bps, isVerified: false,
      displayName: input.displayName ?? null, languages: [...(input.languages ?? [])], visibility: input.visibility ?? 'public',
      verifiedAt: null, verifiedBy: null, verificationNote: null,
    });
  }
  static rehydrate(p: Omit<InstructorProps, 'displayName' | 'languages' | 'visibility' | 'verifiedAt' | 'verifiedBy' | 'verificationNote'> & Partial<InstructorProps>): Instructor {
    return new Instructor({
      ...p, displayName: p.displayName ?? null, languages: [...(p.languages ?? [])], visibility: p.visibility ?? 'public',
      verifiedAt: p.verifiedAt ?? null, verifiedBy: p.verifiedBy ?? null, verificationNote: p.verificationNote ?? null,
    });
  }
  get id() { return this.props.id; }
  get userId() { return this.props.userId; }
  get tenantId() { return this.props.tenantId; }
  get royaltyBps() { return this.props.royaltyBps; }
  get isVerified() { return this.props.isVerified; }
  toProps(): Readonly<InstructorProps> { return Object.freeze({ ...this.props, languages: [...this.props.languages] }); }

  /** PC-26's bio-only patch, kept for its callers; the form chain uses `updateProfile`. */
  update(patch: { bio?: string | null }): void { if (patch.bio !== undefined) this.props.bio = patch.bio; }
  /** The instructor's own fields — W419 *"only bio, languages and credentials are yours to edit"* (and the name, and who sees it). */
  updateProfile(p: InstructorProfilePatch): void {
    if (p.displayName !== undefined) this.props.displayName = p.displayName;
    if (p.bio !== undefined) this.props.bio = p.bio;
    if (p.languages !== undefined) this.props.languages = [...p.languages];
    if (p.visibility !== undefined) this.props.visibility = p.visibility;
  }
  /** The desk's act. The service has already refused a self-verification and a verification with no accepted credential. */
  verify(by: string, at: Date, note: string | null): void {
    if (this.props.isVerified) throw new InvalidCourseError('instructor already verified');
    if (by === this.props.userId) throw new InvalidCourseError('an instructor cannot verify their own record');
    this.props = { ...this.props, isVerified: true, verifiedAt: at, verifiedBy: by, verificationNote: note };
  }
  /** The revocation. The reason lives on the audit row; the row forgets the checker (the CHECK wants all three or none). */
  unverify(): void {
    if (!this.props.isVerified) throw new InvalidCourseError('instructor is not verified');
    this.props = { ...this.props, isVerified: false, verifiedAt: null, verifiedBy: null, verificationNote: null };
  }
  toJSON() {
    const v = this.props;
    return {
      id: v.id, userId: v.userId, bio: v.bio, royaltyBps: v.royaltyBps, isVerified: v.isVerified, createdAt: v.createdAt,
      displayName: v.displayName, languages: [...v.languages], visibility: v.visibility, verifiedAt: v.verifiedAt, verifiedBy: v.verifiedBy, verificationNote: v.verificationNote,
    };
  }
}
