import cds, { type Request } from '@sap/cds';
import { BusinessError, type ProcurementCase } from './rules.ts';

export const workspaceEntity = 'procurement.DecisionWorkspaces';

/** Update only the active workspace. Existing drafts retain their original version and inputs. */
export async function syncWorkspace(req: Request, procurementCase: ProcurementCase) {
  const changed = await cds.tx(req).run(cds.ql.UPDATE.entity(workspaceEntity).set({
    baseCaseVersion: procurementCase.version,
    selectedOffer_ID: procurementCase.selectedOffer_ID,
    reason: procurementCase.reason,
    extraCostReason: procurementCase.extraCostReason,
    modifiedAt: new Date().toISOString(), modifiedBy: req.user.id
  }).where({ ID: procurementCase.ID, procurementCase_ID: procurementCase.ID }));
  if (changed !== 1) throw new BusinessError('WORKSPACE_ASSIGNMENT_INVALID', 409);
}
