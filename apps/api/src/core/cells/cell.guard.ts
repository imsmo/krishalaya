// core/cells/cell.guard.ts · PC-53. LAST-LINE residency guard: if a request for another cell's tenant lands
// here (edge misroute/misconfig), REFUSE with 421 Misdirected Request + the correct cell in X-Cell — never
// silently serve data that must reside elsewhere. Strict no-op until a second cell exists (CELL_ID unset or
// the map names only one cell), so today's behaviour is byte-identical. Rule Zero: this never blocks a
// country — it points the caller at the right one.
import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { parseCellMap, cellFor, isSingleCell, type CellMap } from './cell-resolver';

@Injectable()
export class CellGuard implements CanActivate {
  private readonly map: CellMap = parseCellMap(process.env.CELL_MAP);
  private readonly thisCell = process.env.CELL_ID;
  private readonly active = !isSingleCell(this.map, this.thisCell);

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.active || ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest();
    const tenantId = (req.headers?.['x-tenant-id'] as string | undefined) ?? req.context?.tenantId;
    const countryCode = req.headers?.['x-country'] as string | undefined;
    if (!tenantId && !countryCode) return true; // unresolvable (public/anon) — the edge owns that decision
    const target = cellFor(this.map, { tenantId, countryCode });
    if (target === this.thisCell) return true;
    const res = ctx.switchToHttp().getResponse();
    if (res?.setHeader) res.setHeader('X-Cell', target);
    throw new HttpException({ code: 'WRONG_CELL', message: `This tenant is served by cell ${target}.` }, 421);
  }
}
