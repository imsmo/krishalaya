// apps/admin-api/src/core/media/media.errors.ts · typed errors for the admin download boundary (PC-56 ADMIN-1c).
import { HttpException, HttpStatus } from '@nestjs/common';

/** Storage is not configured in this deploy. 503, not 500: nothing is broken, the capability is absent — and the
 *  console can then say "downloads are not available here" instead of showing an error that implies a fault. */
export class MediaNotConfiguredError extends HttpException {
  constructor() {
    super({ code: 'MEDIA_NOT_CONFIGURED', message: 'object storage is not configured in the admin realm' },
      HttpStatus.SERVICE_UNAVAILABLE);
  }
}

/** The artefact does not exist yet (no media row / no PDF generated). 404 with a distinct code so the caller can say
 *  "not generated yet" rather than "not found", which are different facts to an operator waiting on a document. */
export class MediaAssetMissingError extends HttpException {
  constructor(ref: string) {
    super({ code: 'MEDIA_ASSET_MISSING', message: `no stored asset for ${ref}`, ref }, HttpStatus.NOT_FOUND);
  }
}
