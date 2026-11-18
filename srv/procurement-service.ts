import { registerDemoScope } from './demo/scope.ts';
import { registerSearch } from './lib/search.ts';
import cds, { type Request } from '@sap/cds';
import { BusinessError, evaluationDate, type Action } from './lib/rules.ts';
import { executeAction } from './lib/workflow.ts';
import { registerWorkspaces } from './lib/workspaces.ts';
import { compareOffers, cockpitSummary } from './lib/cockpit.ts';
import { retryOrder } from './integration/outbox.ts';
import { registerOrderWorker } from './integration/runtime.ts';

export default class ProcurementService extends cds.ApplicationService {
  override async init() {
    registerDemoScope(this);
    registerSearch(this);
    this.on('session', (req: Request) => ({
      userID: req.user.id,
      roles: ['Buyer', 'Approver', 'Reader'].filter(role => req.user.is(role)),
      evaluationDate: evaluationDate()
    }));
    for (const action of ['prepare', 'submit', 'withdraw', 'reopen', 'approve', 'decline'] as Action[]) {
      this.on(action, 'Cases', async (req: Request) => {
        const id = (req.params[0] as { ID?: string } | undefined)?.ID;
        if (!id) return req.reject(404, 'CASE_NOT_FOUND');
        return executeAction(req, action, id, req.data);
      });
    }
    this.on('retryTransfer', 'Cases', async (req: Request) => {
      const id = (req.params[0] as { ID?: string } | undefined)?.ID;
      if (!id) return req.reject(404, 'CASE_NOT_FOUND');
      return retryOrder(req, id, req.data.expectedVersion);
    });
    this.on('cockpitSummary', cockpitSummary);
    this.on('compareOffers', 'Cases', compareOffers);
    registerWorkspaces(this);
    registerOrderWorker();
    this.on('error', (error) => {
      if (error instanceof BusinessError) {
        Object.assign(error, { statusCode: error.status, message: error.code });
      }
    });
    return super.init();
  }
}
