// modules/land-soil-weather/controllers/v1/soil-tests.controller.ts · soil tests + weather advisory browse. `land_soil_weather` flag.
import { Controller, Get, Headers, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { SoilTestService } from '../../services/soil-test.service';
import { WeatherAlertService } from '../../services/weather-alert.service';
import { ForecastService } from '../../services/forecast.service';
import { WeatherPrefsService } from '../../services/weather-prefs.service';
import { WeatherPrefsSchema, WeatherPrefsDto } from '../../dto/weather-prefs.dto';
import { RecordSoilTestSchema, RecordSoilTestDto } from '../../dto/create-soil-test.dto';
import { QuerySoilTestsSchema, QuerySoilTestsDto } from '../../dto/query-soil-test.dto';
import { QueryWeatherSchema, QueryWeatherDto } from '../../dto/query-weather-alert.dto';
import { QueryForecastSchema, QueryForecastDto } from '../../dto/query-forecast.dto';
import { LandPermissions, canManageLand, isLandAdmin } from '../../policies/land-soil-weather.policies';

@Controller({ path: 'land', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('land_soil_weather')
export class SoilTestsController {
  constructor(private readonly soil: SoilTestService, private readonly weather: WeatherAlertService, private readonly forecast: ForecastService, private readonly prefs: WeatherPrefsService) {}
  private actor(ctx: RequestContext, req?: Request) { return { userId: ctx.userId, canManage: canManageLand(ctx), isAdmin: isLandAdmin(ctx), ip: req?.ip || null, requestId: ctx.requestId || null }; }

  @Post('soil-tests') @RequirePermissions(LandPermissions.Manage)
  /** PC-56 TENANT-12 (F-11, Law 3): keyed — a retried lab entry is ONE row; audited. */
  record(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(RecordSoilTestSchema) dto: RecordSoilTestDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.soil.record(ctx.tenantId, this.actor(ctx, req), key, dto).then((data) => ({ data }));
  }
  @Get('soil-tests')
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QuerySoilTestsSchema) q: QuerySoilTestsDto) { return this.soil.list(ctx.tenantId, this.actor(ctx), q.parcelId).then((data) => ({ data })); }

  // regional weather advisories (read-only, ingested reference data)
  @Get('weather-alerts')
  weather_(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryWeatherSchema) q: QueryWeatherDto) { return this.weather.listForRegion(ctx.tenantId, q.regionId, q.activeOnly, q.limit).then((data) => ({ data })); }

  // geocoded forecast (P0-12): a real provider forecast for lat/lng, cached + resilience-wrapped. If the provider
  // is down and a regionId was given, it DEGRADES to that region's real advisories (degraded:true) — never faked.
  @Get('weather-forecast')
  forecast_(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryForecastSchema) q: QueryForecastDto) {
    return this.forecast.forecast(ctx.tenantId, q).then((data) => ({ data }));
  }

  // the caller's own weather advisory prefs (P1-4). GET returns saved-or-defaults; PUT upserts. Content toggles
  // only — notification CHANNEL delivery (push/SMS/quiet-hours) is managed in the communication module (P-04).
  @Get('weather-prefs')
  prefs_(@CurrentContext() ctx: RequestContext) { return this.prefs.get(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Put('weather-prefs')
  savePrefs_(@CurrentContext() ctx: RequestContext, @ZodBody(WeatherPrefsSchema) dto: WeatherPrefsDto) { return this.prefs.save(ctx.tenantId, ctx.userId, dto).then((data) => ({ data })); }
}
