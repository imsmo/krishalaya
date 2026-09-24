// modules/education/domain/instructor-credential.entity.ts · PC-56 TENANT-7d · one qualification an instructor files
// (W419 *"BVSc & AH — GAU"*), with its scan as a core/media document and the tenant desk's review.
//
//   submitted ──accept──▶ accepted        (the desk checked the document — a person's act; nothing here reads a face)
//   submitted ──reject──▶ rejected        (WITH a note the instructor reads: *"the certificate photo was too blurred"*)
//   rejected  ──re-upload▶ submitted      (W419 *"Re-upload a clearer scan"* — the form chain, on the same row)
//   any but withdrawn ──withdraw──▶ withdrawn   (the instructor's own act; final)
//
// Transitions are listed here (Law 5: one place) and re-checked by 0173's CHECKs and triggers.
import { InvalidCourseError } from './education.errors';

export const CREDENTIAL_STATUSES = ['submitted', 'accepted', 'rejected', 'withdrawn'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];
/** The media kinds a credential's scan may be: a photo of the certificate, or the PDF. */
export const CREDENTIAL_DOCUMENT_KINDS: ReadonlySet<string> = new Set(['image', 'document']);

const TRANSITIONS: Record<CredentialStatus, readonly CredentialStatus[]> = {
  submitted: ['accepted', 'rejected', 'withdrawn'],
  accepted: ['withdrawn'],
  rejected: ['submitted', 'withdrawn'],
  withdrawn: [],
};
export function canCredentialTransition(from: CredentialStatus, to: CredentialStatus): boolean { return TRANSITIONS[from].includes(to); }

export interface InstructorCredentialProps {
  id: string; tenantId: string; instructorId: string; title: string; issuer: string | null; yearAwarded: number | null; documentMediaId: string;
  status: CredentialStatus; submittedAt: Date; reviewedAt: Date | null; reviewedBy: string | null; reviewNote: string | null;
}
export interface CredentialContent { title: string; issuer: string | null; yearAwarded: number | null; documentMediaId: string }

export class InstructorCredential {
  private constructor(private props: InstructorCredentialProps) {}
  static file(input: { id: string; tenantId: string; instructorId: string; at: Date } & CredentialContent): InstructorCredential {
    if (!input.title.trim()) throw new InvalidCourseError('credential title required');
    return new InstructorCredential({
      id: input.id, tenantId: input.tenantId, instructorId: input.instructorId, title: input.title, issuer: input.issuer, yearAwarded: input.yearAwarded, documentMediaId: input.documentMediaId,
      status: 'submitted', submittedAt: input.at, reviewedAt: null, reviewedBy: null, reviewNote: null,
    });
  }
  static rehydrate(p: InstructorCredentialProps): InstructorCredential { return new InstructorCredential(p); }
  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get instructorId() { return this.props.instructorId; }
  toProps(): Readonly<InstructorCredentialProps> { return Object.freeze({ ...this.props }); }

  /** W419 *"Re-upload a clearer scan"*: a rejected credential, re-filed with a new document (and, if wished, a corrected title). Back to the desk's queue. */
  refile(c: CredentialContent, at: Date): void {
    if (!canCredentialTransition(this.props.status, 'submitted')) throw new InvalidCourseError(`credential ${this.props.status} → submitted is not a transition`);
    this.props = { ...this.props, ...c, status: 'submitted', submittedAt: at, reviewedAt: null, reviewedBy: null, reviewNote: null };
  }
  accept(by: string, at: Date, note: string | null): void {
    if (!canCredentialTransition(this.props.status, 'accepted')) throw new InvalidCourseError(`credential ${this.props.status} → accepted is not a transition`);
    this.props = { ...this.props, status: 'accepted', reviewedAt: at, reviewedBy: by, reviewNote: note };
  }
  reject(by: string, at: Date, note: string): void {
    if (!canCredentialTransition(this.props.status, 'rejected')) throw new InvalidCourseError(`credential ${this.props.status} → rejected is not a transition`);
    if (!note.trim()) throw new InvalidCourseError('a rejection carries a note');
    this.props = { ...this.props, status: 'rejected', reviewedAt: at, reviewedBy: by, reviewNote: note };
  }
  withdraw(): void {
    if (!canCredentialTransition(this.props.status, 'withdrawn')) throw new InvalidCourseError(`credential ${this.props.status} → withdrawn is not a transition`);
    this.props = { ...this.props, status: 'withdrawn' };
  }
  toJSON() {
    const v = this.props;
    return { id: v.id, instructorId: v.instructorId, title: v.title, issuer: v.issuer, yearAwarded: v.yearAwarded, documentMediaId: v.documentMediaId, status: v.status, submittedAt: v.submittedAt, reviewedAt: v.reviewedAt, reviewedBy: v.reviewedBy, reviewNote: v.reviewNote };
  }
}
