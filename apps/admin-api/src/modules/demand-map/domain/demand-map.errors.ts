// apps/admin-api/src/modules/demand-map/domain/demand-map.errors.ts · (PC-56 ADMIN-SWEEP-c3)
import { HttpException, HttpStatus } from '@nestjs/common';
import { DemandRuleError } from './demand-map';

export class InvalidDemandRequestError extends HttpException {
  constructor(e: DemandRuleError) {
    super({ code: e.code, message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class ExportGrantMissingError extends HttpException {
  constructor() {
    super(
      { code: 'DEMAND_EXPORT_GRANT', message: 'exporting needs analytics.export in addition to analytics.read — the operator who may look is not automatically the one who may take a file away' },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** W108's own error state ("Couldn't build demand map … underlying marketplaces are unaffected"): the assembly
 *  refuses with the failing source NAMED rather than rendering a partial map as complete. */
export class DemandAssemblyFailedError extends HttpException {
  constructor(source: string) {
    super(
      { code: 'DEMAND_ASSEMBLY_FAILED', message: `could not build the demand map: the ${source} read failed — the underlying marketplaces are unaffected; partial data is never shown as complete` },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
