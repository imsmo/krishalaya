// modules/catalogue/services/public-certificate.service.ts · PC-56 STORE-5b · D1 (founder Q7) — the PUBLIC certificate read (canon W305).
// No auth. Reads ONLY through the SECURITY DEFINER `public_certificate` / `public_certificate_by_no` (migration 0219 — NULL unless the
// organisation is live) and answers ONLY `publicCertificate`'s allow-list (domain/certificate-public.ts).
//   • the flag `certificates_public` (Law 10, seeded OFF): the platform kill-switch refuses FIRST (nothing is read); then the certificate's
//     organisation's own answer — OFF → 404 CERTIFICATE_NOT_PUBLISHED (≠ CERTIFICATE_NOT_FOUND: OFF is not "not found");
//   • by ID (`GET /v1/certificates/public/:id` — the trace page's link): the id is the capability, no tenant needed;
//   • by NUMBER (`GET /v1/certificates/public?no=` — the lookup form): within the REQUEST's organisation (the host's / the slug's —
//     TenantContextMiddleware, which already refused an anonymous caller a non-live one); no organisation in context → 400 TENANT_REQUIRED.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { DomainError } from '../../../shared/errors/app-error';
import { UUID_RE } from '../../../shared/pagination/us-keyset';
import { CertificateRepository } from '../repositories/certificate.repository';
import { CertificateNotFoundError, CertificateNotPublishedError } from '../domain/catalogue.errors';
import { publicCertificate, PublicCertificate } from '../domain/certificate-public';

export const CERTIFICATES_PUBLIC_FLAG = 'certificates_public';

@Injectable()
export class PublicCertificateService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly flags: FlagsService,
    private readonly repo: CertificateRepository,
  ) {}

  async byId(id: string): Promise<PublicCertificate> {
    if (await this.flags.isKillSwitched(CERTIFICATES_PUBLIC_FLAG)) throw new CertificateNotPublishedError();
    if (!UUID_RE.test(id)) throw new CertificateNotFoundError(id);
    const row = await this.uow.run('', (tx) => this.repo.publicById(tx, id));
    return this.answer(row, id);
  }

  async byNo(contextTenantId: string | null | undefined, certNo: string): Promise<PublicCertificate> {
    if (await this.flags.isKillSwitched(CERTIFICATES_PUBLIC_FLAG)) throw new CertificateNotPublishedError();
    if (!contextTenantId || !UUID_RE.test(contextTenantId)) throw new DomainError('TENANT_REQUIRED', 'A certificate number is looked up within one organisation', 400);
    const no = String(certNo ?? '').trim();
    if (!no || no.length > 100) throw new CertificateNotFoundError(no.slice(0, 100));
    const row = await this.uow.run('', (tx) => this.repo.publicByNo(tx, contextTenantId, no));
    return this.answer(row, no);
  }

  private async answer(row: Record<string, unknown> | null, ref: string): Promise<PublicCertificate> {
    if (!row) throw new CertificateNotFoundError(ref);                       // unknown, removed, or the organisation is not live
    const tenantId = typeof row.tenantId === 'string' ? row.tenantId : null;
    if (!tenantId || !(await this.flags.isEnabled(CERTIFICATES_PUBLIC_FLAG, { tenantId }).catch(() => false))) {
      this.metrics.inc('catalogue.certificate_public_not_published');
      throw new CertificateNotPublishedError();
    }
    this.metrics.inc('catalogue.certificate_public_read');
    return publicCertificate(row);
  }
}
