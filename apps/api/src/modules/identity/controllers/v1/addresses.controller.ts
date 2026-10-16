// modules/identity/controllers/v1/addresses.controller.ts · owner-scoped address book.
// PC-56 HOTFIX-6 · B3/B4: create and edit accept an OPTIONAL Idempotency-Key (a replay returns the first answer — an edit of an address in
// use answers the same new id, never a second copy); an edit answers `{ id, copied, previousId }` (copy-on-write); a remove of an address
// that is not yours → 404; the list is capped at 50.
import { Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { AddressService } from '../../services/address.service';
import { CreateAddressSchema, CreateAddressDto, UpdateAddressSchema, UpdateAddressDto } from '../../dto/create-address.dto';

@Controller({ path: 'addresses', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class AddressesController {
  constructor(private readonly addresses: AddressService) {}
  @Get() list(@CurrentContext() ctx: RequestContext) { return this.addresses.list(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  // PC-56 STORE-4a · B3: one of the caller's addresses (the edit form's current values) — anybody else's → 404
  @Get(':id') get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.addresses.get(ctx.tenantId, ctx.userId, id).then((data) => ({ data })); }
  @Post() create(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string | undefined, @ZodBody(CreateAddressSchema) dto: CreateAddressDto) { return this.addresses.create(ctx.tenantId, ctx.userId, dto, key || undefined).then((data) => ({ data })); }
  @Patch(':id') update(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @ZodBody(UpdateAddressSchema) dto: UpdateAddressDto) { return this.addresses.update(ctx.tenantId, ctx.userId, id, dto, key || undefined).then((data) => ({ data })); }
  @Delete(':id') remove(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.addresses.remove(ctx.tenantId, ctx.userId, id).then((data) => ({ data })); }
}
