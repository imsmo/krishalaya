// modules/catalogue/domain/certificate.entity.ts · an organic/GI/lab/etc. certificate attached to a product,
// farm, listing, or the tenant (PRD §9.11/§26). Pure TS — all invariants + the verify/reject/expire transitions
// (delegating to certificate.state, Law 5). Tenant-scoped (tenant_id). cert_type is a lookup_values('cert_type')
// ref; the proof document is a media_assets id (never raw bytes). Emits integration events for the outbox.
import { assertTransition, CertificateStatus } from './certificate.state';
import { InvalidCertificateError } from './catalogue.errors';
import type { DomainEvent } from './catalogue.events';

export const CERT_SUBJECT_TYPES = ['product', 'farm', 'tenant', 'listing'] as const;
export type CertSubjectType = (typeof CERT_SUBJECT_TYPES)[number];

export interface CertificateProps {
  id: string; tenantId: string; ownerUserId: string | null; certTypeId: string; certNo: string | null;
  issuingBody: string | null; subjectType: CertSubjectType | string; subjectId: string | null; mediaId: string | null;
  validFrom: string | null; validUntil: string | null; status: CertificateStatus; blockchainAnchor: string | null;
  verifiedBy: string | null; createdAt?: Date | null;
  /** PC-56 HOTFIX-7 · B24: `created_at` as the database printed it (µs) — the keyset cursor only, stripped from every answer. */
  createdAtUs?: string | null;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export class Certificate {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: CertificateProps) {}

  static create(input: Omit<CertificateProps, 'status' | 'verifiedBy'>): Certificate {
    if (!(CERT_SUBJECT_TYPES as readonly string[]).includes(input.subjectType)) throw new InvalidCertificateError(`subject_type must be one of ${CERT_SUBJECT_TYPES.join('|')}`);
    if (input.subjectId == null) throw new InvalidCertificateError('subject_id is required');
    if (input.certNo != null && input.certNo.length > 100) throw new InvalidCertificateError('cert_no exceeds 100 chars');
    if (input.issuingBody != null && input.issuingBody.length > 200) throw new InvalidCertificateError('issuing_body exceeds 200 chars');
    if (input.validFrom != null && !isDate(input.validFrom)) throw new InvalidCertificateError('valid_from must be YYYY-MM-DD');
    if (input.validUntil != null && !isDate(input.validUntil)) throw new InvalidCertificateError('valid_until must be YYYY-MM-DD');
    if (input.validFrom != null && input.validUntil != null && input.validUntil < input.validFrom) throw new InvalidCertificateError('valid_until before valid_from');
    const c = new Certificate({ ...input, status: 'pending', verifiedBy: null });
    c.events.push({ type: 'catalogue.certificate_submitted', payload: { certId: c.props.id, tenantId: input.tenantId, subjectType: input.subjectType, subjectId: input.subjectId } });
    return c;
  }
  static rehydrate(props: CertificateProps): Certificate { return new Certificate(props); }

  get id() { return this.props.id; }
  get status(): CertificateStatus { return this.props.status; }
  toProps(): Readonly<CertificateProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Moderator approves: optionally (re)sets the validity window; a cert already past validity can't be verified. */
  verify(verifierUserId: string, validFrom: string | null, validUntil: string | null, asOf: Date = new Date()): void {
    assertTransition(this.props.status, 'verified');
    const from = validFrom ?? this.props.validFrom;
    const until = validUntil ?? this.props.validUntil;
    if (from != null && !isDate(from)) throw new InvalidCertificateError('valid_from must be YYYY-MM-DD');
    if (until != null && !isDate(until)) throw new InvalidCertificateError('valid_until must be YYYY-MM-DD');
    if (from != null && until != null && until < from) throw new InvalidCertificateError('valid_until before valid_from');
    if (until != null && new Date(until) < asOf) throw new InvalidCertificateError('cannot verify an already-expired certificate');
    this.props.status = 'verified'; this.props.verifiedBy = verifierUserId; this.props.validFrom = from; this.props.validUntil = until;
    this.events.push({ type: 'catalogue.certificate_verified', payload: { certId: this.props.id, subjectType: this.props.subjectType, subjectId: this.props.subjectId, validUntil: until } });
  }

  reject(deciderUserId: string, reason: string): void {
    assertTransition(this.props.status, 'rejected');
    this.props.status = 'rejected'; this.props.verifiedBy = deciderUserId;
    this.events.push({ type: 'catalogue.certificate_rejected', payload: { certId: this.props.id, reason } });
  }

  expire(): void {
    assertTransition(this.props.status, 'expired');
    this.props.status = 'expired';
    this.events.push({ type: 'catalogue.certificate_expired', payload: { certId: this.props.id, subjectType: this.props.subjectType, subjectId: this.props.subjectId } });
  }

  /** A verified cert whose validity window has passed is effectively expired (the job flips status). */
  isExpired(asOf: Date = new Date()): boolean {
    return this.props.status === 'verified' && this.props.validUntil != null && new Date(this.props.validUntil) < asOf;
  }
}
