// modules/livestock/controllers/v1/animals.controller.ts · farmer animal registry + species/breed browse.
// register/update/retire act on the CALLER's OWN animals (owner = ctx.userId, never client-supplied; reads
// 404 on non-owner — no cross-owner IDOR). Species/breed browse is any authenticated user. `livestock` flag.
import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AnimalService } from '../../services/animal.service';
import { AnimalSpeciesService } from '../../services/animal-species.service';
import { CreateAnimalSchema, CreateAnimalDto, UpdateAnimalSchema, UpdateAnimalDto, RetireAnimalSchema, RetireAnimalDto } from '../../dto/create-animal.dto';
import { QueryAnimalsSchema, QueryAnimalsDto } from '../../dto/query-animal.dto';
import { QuerySpeciesSchema, QuerySpeciesDto } from '../../dto/query-animal-species.dto';
import { QueryBreedsSchema, QueryBreedsDto } from '../../dto/query-animal-breed.dto';
import { LivestockPermissions, canManageAnimals, isLivestockAdmin } from '../../policies/livestock.policies';
import { HealthService } from '../../services/health.service';
import { z } from 'zod';

// PC-54 W54-4 health-event DTO (zod .strict(); eventTypeCode from the seeded 'animal_health_event' vocab).
const RecordHealthEventSchema = z.object({
  eventTypeCode: z.string().min(1).max(40),
  vetBookingId: z.string().uuid().optional(),
  batchNo: z.string().max(80).optional(),
  diagnosis: z.string().max(2000).optional(),
  outcome: z.string().max(2000).optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
type RecordHealthEventDto = z.infer<typeof RecordHealthEventSchema>;

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'livestock', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('livestock')
export class AnimalsController {
  constructor(private readonly animals: AnimalService, private readonly taxonomy: AnimalSpeciesService, private readonly health: HealthService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageAnimals(ctx), isAdmin: isLivestockAdmin(ctx) }; }

  @Get('species')
  species(@CurrentContext() ctx: RequestContext, @ZodQuery(QuerySpeciesSchema) q: QuerySpeciesDto) { return this.taxonomy.listSpecies(ctx.tenantId, q.activeOnly).then((data) => ({ data })); }
  @Get('breeds')
  breeds(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBreedsSchema) q: QueryBreedsDto) { return this.taxonomy.listBreeds(ctx.tenantId, q.speciesId).then((data) => ({ data })); }

  @Post('animals') @RequirePermissions(LivestockPermissions.AnimalManage)
  register(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateAnimalSchema) dto: CreateAnimalDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.animals.register(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get('animals')
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAnimalsSchema) q: QueryAnimalsDto) {
    return this.animals.list(ctx.tenantId, this.actor(ctx), { box: q.box, speciesId: q.speciesId, pashuAadhaar: q.pashuAadhaar, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('animals/:id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.animals.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Patch('animals/:id') @RequirePermissions(LivestockPermissions.AnimalManage)
  update(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(UpdateAnimalSchema) dto: UpdateAnimalDto) { return this.animals.update(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  // --- PC-54 W54-4 `livestock-health-records` (0009 §18.12): the lifetime health file ---
  @Post('animals/:id/health-events') @RequirePermissions(LivestockPermissions.AnimalManage)
  recordHealthEvent(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(RecordHealthEventSchema) dto: RecordHealthEventDto) {
    return this.health.recordEvent(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
  @Get('animals/:id/health-events')
  listHealthEvents(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.health.listEvents(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  @Post('animals/:id/retire') @RequirePermissions(LivestockPermissions.AnimalManage)
  retire(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(RetireAnimalSchema) dto: RetireAnimalDto) { return this.animals.retire(ctx.tenantId, this.actor(ctx), id, dto.reason).then((data) => ({ data })); }
}
