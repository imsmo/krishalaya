// apps/admin-api/src/modules/comm-hub/domain/comm-hub.errors.ts · PC-56 ADMIN-SWEEP-b2.
import { HttpException, HttpStatus } from '@nestjs/common';
import { HubRuleError } from './comm-hub';

/** 409: the operator holds `support.hub` and the request is well-formed; what is wrong is their own recorded state
 *  (on break) or the queue's (nothing to claim was a data answer, not an error). The sentence rides through. */
export class HubNotClaimableError extends HttpException {
  constructor(e: HubRuleError) { super({ code: e.code, message: e.message }, HttpStatus.CONFLICT); }
}
export class HubPrincipalNotFoundError extends HttpException {
  constructor() { super({ code: 'HUB_PRINCIPAL_NOT_FOUND', message: 'no such principal in the support register' }, HttpStatus.NOT_FOUND); }
}
