import { caseScope } from '../demo/scope.ts';
import { demoSelfApprovalAllowed } from '../demo/approval.ts';
import cds, { type Request } from '@sap/cds';
import {
  BusinessError, evaluate, evaluationDate, fingerprint, requireReasons, text, transition,
  type Action, type Demand, type Offer, type ProcurementCase, type Submission
} from './rules.ts';

import { syncWorkspace } from './workspace-state.ts';
import { enqueueOrder } from '../integration/outbox.ts';

const { SELECT, UPDATE, INSERT } = cds.ql;
const entities = {
  cases: 'procurement.Cases', offers: 'procurement.Offers', demands: 'procurement.Demands',
  submissions: 'procurement.Submissions', history: 'procurement.History'
};
const eventNames: Record<Action, string> = {
  prepare: 'Prepared', submit: 'Submitted', withdraw: 'Withdrawn',
  reopen: 'Reopened', approve: 'Approved', decline: 'Rejected'
};

/** Shared transaction boundary for OData actions and draft activation. */
export async function executeAction(req: Request, action: Action, id: string, input: Record<string, unknown>) {
  const expectedVersion: unknown = input.expectedVersion;
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) {
    throw new BusinessError('VERSION_REQUIRED');
  }
  const tx = cds.tx(req);
  const procurementCase = await tx.run(SELECT.one.from(entities.cases).where({ ID: id, ...caseScope(req) })) as ProcurementCase | undefined;
  if (!procurementCase) throw new BusinessError('CASE_NOT_FOUND', 404);
  if (procurementCase.version !== expectedVersion) throw new BusinessError('STALE_VERSION', 409);
  const rule = transition(action, procurementCase.status);
  if (!req.user.is(rule.role)) throw new BusinessError('ROLE_REQUIRED', 403);

  // Claim the case atomically before applying any effects. All later failures roll this back.
  const version = (expectedVersion as number) + 1;
  const claimed = await tx.run(UPDATE.entity(entities.cases).set({ version }).where({ ID: id, version: expectedVersion }));
  if (claimed !== 1) throw new BusinessError('STALE_VERSION', 409);

  const now = new Date().toISOString();
  const changes: Record<string, unknown> = {
    status: rule.to, modifiedAt: now, modifiedBy: req.user.id
  };
  let submissionID = procurementCase.currentSubmission_ID;
  let historyReason = '';
  const today = evaluationDate();

  if (action === 'prepare' || action === 'submit' || action === 'approve') {
    const demand = await tx.run(SELECT.one.from(entities.demands).where({ ID: procurementCase.demand_ID })) as Demand | undefined;
    if (!demand) throw new BusinessError('DEMAND_NOT_FOUND', 404);
    const offerID = action === 'prepare' ? input.offerID : procurementCase.selectedOffer_ID;
    if (!offerID) throw new BusinessError('OFFER_REQUIRED');
    const offer = await tx.run(SELECT.one.from(entities.offers).where({ ID: offerID })) as Offer | undefined;
    if (!offer) throw new BusinessError('OFFER_NOT_FOUND', 404);
    const amounts = evaluate(offer, demand, procurementCase, today);
    const offerFingerprint = fingerprint(offer);

    if (action === 'prepare') {
      if (input.expectedOfferFingerprint != null && input.expectedOfferFingerprint !== offerFingerprint) {
        throw new BusinessError('OFFER_CHANGED', 409);
      }
      Object.assign(changes, {
        selectedOffer_ID: offer.ID, selectedOfferFingerprint: offerFingerprint,
        reason: text(input.reason), extraCostReason: text(input.extraCostReason),
        totalCost: amounts.totalCost, extraCost: amounts.extraCost, delayDays: amounts.delayDays
      });
    } else {
      if (procurementCase.selectedOfferFingerprint !== offerFingerprint) {
        throw new BusinessError('OFFER_CHANGED', 409);
      }
      if (action === 'submit') {
        requireReasons(procurementCase.reason, procurementCase.extraCostReason, amounts.needsExtraReason);
        submissionID = cds.utils.uuid();
        const revision = procurementCase.submissionSequence + 1;
        await tx.run(INSERT.into(entities.submissions).entries({
          ID: submissionID, procurementCase_ID: id, revision,
          offer_ID: offer.ID, offerVersion: offer.version, offerFingerprint,
          material_ID: offer.material_ID, supplier_ID: offer.supplier_ID,
          quantity: offer.quantity, unit: offer.unit, currency: offer.currency,
          unitPrice: String(offer.unitPrice), shipping: String(offer.shipping),
          totalCost: amounts.totalCost, extraCost: amounts.extraCost,
          referenceTotal: String(procurementCase.referenceTotal), delayDays: amounts.delayDays,
          deliveryDate: offer.deliveryDate, validUntil: offer.validUntil,
          reason: text(procurementCase.reason), extraCostReason: text(procurementCase.extraCostReason),
          submittedBy: req.user.id, submittedAt: now, evaluatedOn: today
        }));
        Object.assign(changes, { currentSubmission_ID: submissionID, submissionSequence: revision });
        historyReason = text(procurementCase.reason);
      } else {
        if (!submissionID) throw new BusinessError('SUBMISSION_REQUIRED', 409);
        const submission = await tx.run(SELECT.one.from(entities.submissions).where({ ID: submissionID })) as Submission | undefined;
        if (!submission || submission.procurementCase_ID !== id || submission.revision !== procurementCase.submissionSequence) {
          throw new BusinessError('SUBMISSION_REQUIRED', 409);
        }
        if (submission.submittedBy === req.user.id && !demoSelfApprovalAllowed(req)) throw new BusinessError('SELF_APPROVAL', 403);
        if (submission.offer_ID !== offer.ID || submission.offerFingerprint !== offerFingerprint) {
          throw new BusinessError('OFFER_CHANGED', 409);
        }
      }
    }
  }
  if (action === 'withdraw' || action === 'reopen') changes.currentSubmission_ID = null;
  if (action === 'decline') {
    historyReason = text(input.reason);
    if (!historyReason) throw new BusinessError('REJECTION_REASON_REQUIRED');
  }

  if (action === 'approve') changes.transfer_ID = await enqueueOrder(req, id, submissionID!);

  await tx.run(UPDATE.entity(entities.cases).set(changes).where({ ID: id, version }));
  await tx.run(INSERT.into(entities.history).entries({
    ID: cds.utils.uuid(), procurementCase_ID: id, submission_ID: submissionID,
    event: eventNames[action], fromStatus: procurementCase.status, toStatus: rule.to,
    caseVersion: version, actor: req.user.id, occurredAt: now, reason: historyReason || null
  }));
  const saved = await tx.run(SELECT.one.from(entities.cases).where({ ID: id, ...caseScope(req) })) as ProcurementCase;
  if (action === 'prepare') await syncWorkspace(req, saved);
  return saved;
}
