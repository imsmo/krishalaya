// modules/land-soil-weather/land-soil-weather.module.ts
// Land, Soil & Weather (PRD M24): the farm-data backbone. Farmers register their land parcels (survey/khasra
// + bhulekh linkage, area, irrigation, boundary), track crop seasons (plan→sow→harvest), and record Soil
// Health Card results; everyone can browse regional weather advisories. This is an agronomy DATA + ADVISORY
// module — there is NO in-platform money path. Gated by the `land_soil_weather` feature flag (default OFF).
//
// SCOPE (this build): land parcels (farm registry) + crop seasons (lifecycle) + soil tests + read-only
// regional weather-alert browse.
// PC-56 TENANT-12: the advisory push job is REGISTERED (F-5/F-6); parcels carry a validated GeoJSON boundary (F-2); every land
// write is audited (F-11); yields carry their unit (F-9); `land.admin` is the desk (F-12).
// DEFERRED (schema in 0010 / platform surface): weather-alert INGESTION (IMD/Skymet pipeline, Law 11 — refused by name),
// bhulekh-verify job, parcel verification_status workflow (KYC/admin), PostGIS boundary
// geometry/area auto-calc, soil-test recommendation engine. (land_parcels.id is already the FK target for
// contract_growers.land_parcel_id — cross-module reference only, no import.)
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../core/outbox/outbox.writer';
import { FlagsService } from '../../core/feature-flags/flags.service';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { ParcelsController } from './controllers/v1/parcels.controller';
import { CropSeasonsController } from './controllers/v1/crop-seasons.controller';
import { SoilTestsController } from './controllers/v1/soil-tests.controller';
import { LandParcelService } from './services/land-parcel.service';
import { CropSeasonService } from './services/crop-season.service';
import { SoilTestService } from './services/soil-test.service';
import { WeatherAlertService } from './services/weather-alert.service';
import { ForecastService } from './services/forecast.service';
import { WeatherPrefsService } from './services/weather-prefs.service';
import { weatherForecastProvider } from './gateway/weather-forecast.provider';
import { reverseGeocodeProvider } from './gateway/reverse-geocode.provider';
import { WeatherAdvisoryPushJob } from './jobs/weather-advisory-push.job';
import { LandParcelRepository } from './repositories/land-parcel.repository';
import { CropSeasonRepository } from './repositories/crop-season.repository';
import { SoilTestRepository } from './repositories/soil-test.repository';
import { WeatherAlertRepository } from './repositories/weather-alert.repository';
import { WeatherPrefsRepository } from './repositories/weather-prefs.repository';

@Module({
  controllers: [ParcelsController, CropSeasonsController, SoilTestsController],
  providers: [
    LandParcelService, CropSeasonService, SoilTestService, WeatherAlertService, ForecastService, WeatherPrefsService,
    weatherForecastProvider, reverseGeocodeProvider, UiMessageRepository,
    // PC-56 TENANT-12 (F-5 / F-6): the advisory push is a REGISTERED cadence job (every 15 minutes), per tenant as kv_app.
    { provide: WeatherAdvisoryPushJob, inject: [UNIT_OF_WORK, OUTBOX_WRITER, FlagsService, UiMessageRepository],
      useFactory: (u: UnitOfWork, o: OutboxWriter, f: FlagsService, ui: UiMessageRepository) => new WeatherAdvisoryPushJob(15 * 60_000, u, o, f, ui) },
    LandParcelRepository, CropSeasonRepository, SoilTestRepository, WeatherAlertRepository, WeatherPrefsRepository,
  ],
  exports: [LandParcelService, CropSeasonService, SoilTestService, WeatherAlertService, ForecastService, WeatherPrefsService, WeatherAdvisoryPushJob],
})
export class LandSoilWeatherModule implements OnModuleInit {
  constructor(@Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry, private readonly advisory: WeatherAdvisoryPushJob) {}
  onModuleInit(): void { this.jobs.register(this.advisory); }
}
