// apps/admin-api/src/modules/farmer360/domain/farmer360.errors.ts · PC-56 ADMIN-SWEEP-b4.
import { HttpException, HttpStatus } from '@nestjs/common';
import { Farmer360RuleError } from './farmer360';

export class FarmerNotFoundError extends HttpException {
  constructor() { super({ code: 'F360_NOT_FOUND', message: 'no such person' }, HttpStatus.NOT_FOUND); }
}
export class InvalidFarmer360RequestError extends HttpException {
  constructor(e: Farmer360RuleError) { super({ code: e.code, message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY); }
}
/** 403 with the CONJUNCTION in it: the caller holds farmer360 (they reached the route) and lacks the export half. */
export class ExportGrantMissingError extends HttpException {
  constructor() {
    super({
      code: 'F360_EXPORT_GRANT_MISSING',
      message: 'Exporting a profile needs analytics.export IN ADDITION to analytics.farmer360 — the reviewer who may look is not automatically the one who may take the file away. Ask for the export grant with a named reason.',
    }, HttpStatus.FORBIDDEN);
  }
}
/** 503, not 200-with-holes: one or more module reads failed and partial data is NEVER shown as complete (W109). */
export class ProfileAssemblyFailedError extends HttpException {
  constructor(source: string) {
    super({
      code: 'F360_ASSEMBLY_FAILED',
      message: `the ${source} read failed — partial data is never shown as complete; retry, and if it persists this is a platform incident, not a display bug`,
    }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
