import { caseScope } from '../demo/scope.ts';
import { demoSelfApprovalAllowed } from '../demo/approval.ts';
import cds, { type Request, type ApplicationService } from '@sap/cds';
import { BusinessError, type ProcurementCase } from './rules.ts';
import { executeAction } from './workflow.ts';
import { syncWorkspace, workspaceEntity } from './workspace-state.ts';

const { SELECT } = cds.ql;
interface WorkspaceDraft {
  ID: string;
  procurementCase_ID: string;
  baseCaseVersion: number;
  selectedOffer_ID: string | null;
  reason: string | null;
  extraCostReason: string | null;
  DraftAdministrativeData: { InProcessByUser: string };
}
function workspaceID(req: Request): string {
  const id = (req.params[0] as { ID?: string } | undefined)?.ID;
  if (!id) throw new BusinessError('CASE_NOT_FOUND', 404);
  return id;
}
function requireBuyer(req: Request) {
  if (!req.user.is('Buyer')) throw new BusinessError('ROLE_REQUIRED', 403);
}

export function registerWorkspaces(service: ApplicationService) {
  const active = service.entities.DecisionWorkspaces!;
  const drafts = active.drafts!;

  service.after('READ', [active, drafts], async (result: unknown, req: Request) => {
    const rows = (Array.isArray(result) ? result : result ? [result] : []) as Array<Record<string, unknown>>;
    const ids = rows.flatMap(row => typeof row.ID === 'string' ? [row.ID] : []);
    if (!ids.length) return;
    const cases = await cds.tx(req).run(SELECT.from('procurement.Cases').columns('ID', 'status', {
      ref: ['currentSubmission', 'submittedBy'], as: 'submittedBy'
    }, { ref: ['transfer', 'status'], as: 'transferStatus' }).where({ ID: { in: ids } })) as Array<{ ID: string; status: string; submittedBy: string | null; transferStatus: string | null }>;
    const indexed = new Map(cases.map(row => [row.ID, row]));
    for (const row of rows) {
      const current = indexed.get(row.ID as string);
      const open = current?.status === 'Open';
      const submitted = current?.status === 'Submitted';
      Object.assign(row, {
        canEdit: req.user.is('Buyer') && open,
        canSubmit: req.user.is('Buyer') && open,
        canWithdraw: req.user.is('Buyer') && submitted,
        canReopen: req.user.is('Buyer') && current?.status === 'Rejected',
        canApprove: req.user.is('Approver') && submitted && (current?.submittedBy !== req.user.id || demoSelfApprovalAllowed(req)),
        canDecline: req.user.is('Approver') && submitted,
        canRetryTransfer: (req.user.is('Buyer') || req.user.is('Approver')) && current?.status === 'Approved' && ['Retry', 'Failed'].includes(current.transferStatus ?? '')
      });
    }
  });

  service.before('EDIT', active, async (req: Request) => {
    requireBuyer(req);
    const id = workspaceID(req);
    const tx = cds.tx(req);
    const procurementCase = await tx.run(SELECT.one.from('procurement.Cases').where({ ID: id, ...caseScope(req) })) as ProcurementCase | undefined;
    if (!procurementCase) throw new BusinessError('CASE_NOT_FOUND', 404);
    if (procurementCase.status !== 'Open') throw new BusinessError('INVALID_STATE', 409);
    // CAP copies this snapshot into its draft in the same transaction. Never refresh it on SAVE.
    await syncWorkspace(req, procurementCase);
  });

  service.before(['NEW', 'CREATE'], drafts, (req: Request) => req.reject(405, 'WORKSPACE_CREATE_FORBIDDEN'));
  service.before('CREATE', active, (req: Request) => req.reject(405, 'WORKSPACE_CREATE_FORBIDDEN'));
  service.before('DELETE', active, (req: Request) => req.reject(405, 'WORKSPACE_DELETE_FORBIDDEN'));
  service.before('UPDATE', drafts, (req: Request) => {
    requireBuyer(req);
    const allowed = new Set(['ID', 'selectedOffer_ID', 'reason', 'extraCostReason']);
    for (const key of Object.keys(req.data)) {
      if (!allowed.has(key)) return req.reject(400, 'WORKSPACE_FIELD_FORBIDDEN');
    }
  });

  service.on('UPDATE', active, async (req: Request) => {
    requireBuyer(req);
    const id = workspaceID(req);
    const tx = cds.tx(req);
    // Read persisted data, not the activation payload or its readonly fields.
    const draft = await tx.run(SELECT.one.from(drafts).columns('*', {
      ref: ['DraftAdministrativeData'], expand: [{ ref: ['InProcessByUser'] }]
    }).where({ ID: id })) as WorkspaceDraft | undefined;
    if (!draft || draft.DraftAdministrativeData?.InProcessByUser !== req.user.id) {
      throw new BusinessError('WORKSPACE_DRAFT_REQUIRED', 403);
    }
    const workspace = await tx.run(SELECT.one.from(workspaceEntity).where({ ID: id })) as { procurementCase_ID: string } | undefined;
    if (!workspace || workspace.procurementCase_ID !== id || draft.procurementCase_ID !== id) {
      throw new BusinessError('WORKSPACE_ASSIGNMENT_INVALID', 409);
    }
    await executeAction(req, 'prepare', id, {
      expectedVersion: draft.baseCaseVersion, offerID: draft.selectedOffer_ID,
      reason: draft.reason, extraCostReason: draft.extraCostReason
    });
    // Shared prepare persisted the allowed inputs and calculated Case data atomically.
    // Do not forward the full draft snapshot to the generic UPDATE handler.
    return tx.run(SELECT.one.from(workspaceEntity).where({ ID: id }));
  });
}
