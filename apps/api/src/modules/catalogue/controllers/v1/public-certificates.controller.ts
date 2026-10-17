// modules/catalogue/controllers/v1/public-certificates.controller.ts · PC-56 STORE-5b · D1 — the PUBLIC certificate page's two reads (canon W305).
// `@Public()`, rate-limited, read-only. Registered BEFORE CertificatesController (the module's controller order) so `/v1/certificates/public`
// is never read as the authenticated `/v1/certificates/:id`.
//   GET /v1/certificates/public/:id     — by id (the trace page links here)
//   GET /v1/certificates/public?no=     — by number, within the REQUEST's organisation (the host's / the slug's)
import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../../../core/auth/public.decorator';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { PublicCertificateService } from '../../services/public-certificate.service';

@Controller({ path: 'certificates/public', version: '1' })
export class PublicCertificatesController {
  constructor(private readonly svc: PublicCertificateService) {}

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get()
  byNo(@CurrentContext() ctx: RequestContext, @Query('no') no: string) {
    return this.svc.byNo(ctx?.tenantId ?? null, typeof no === 'string' ? no : '').then((data) => ({ data }));
  }

  @Public() @RateLimit({ limit: 120, windowSec: 60, by: 'ip' }) @Get(':id')
  byId(@Param('id') id: string) {
    return this.svc.byId(id).then((data) => ({ data }));
  }
}
