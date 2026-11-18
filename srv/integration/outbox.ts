import { caseScope } from '../demo/scope.ts';
import cds, { type Request } from '@sap/cds';
import { BusinessError } from '../lib/rules.ts';
import type { ProcurementCase } from '../lib/rules.ts';
import { payloadFromSnapshot, payloadHash, type OrderSnapshot } from './contract.ts';

const { SELECT, INSERT, UPDATE } = cds.ql;

/** Called inside the approval transaction; it never performs HTTP or opens a separate transaction. */
export async function enqueueOrder(req: Request, caseID: string, submissionID: string): Promise<string> {
  const tx = cds.tx(req);
  const snapshot = await tx.run(SELECT.one.from('procurement.Submissions')
    .columns('*', 'procurementCase.caseNumber as caseNumber', 'procurementCase.demoScope as demoScope',
      'procurementCase.demoSession.expiresAt as demoExpiresAt')
    .where({ ID: submissionID, procurementCase_ID: caseID })) as OrderSnapshot | undefined;
  if (!snapshot) throw new BusinessError('SUBMISSION_REQUIRED', 409);
  const payload = payloadFromSnapshot(snapshot);
  await tx.run(INSERT.into('procurement.Transfers').entries({
    ID: submissionID, procurementCase_ID: caseID, submission_ID: submissionID,
    status: 'Pending', payload: JSON.stringify(payload), payloadHash: payloadHash(payload),
    version: 0, attemptCount: 0, failureCount: 0, nextAttemptAt: new Date().toISOString()
  }));
  return submissionID;
}

/** A manual retry changes only the technical transfer. It never creates a fresh operation or payload. */
export async function retryOrder(req: Request, id: string, expectedVersion: unknown): Promise<ProcurementCase> {
  if (!req.user.is('Buyer') && !req.user.is('Approver')) throw new BusinessError('ROLE_REQUIRED', 403);
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) throw new BusinessError('VERSION_REQUIRED');
  const tx = cds.tx(req);
  const item = await tx.run(SELECT.one.from('procurement.Cases').where({ ID: id, ...caseScope(req) })) as (ProcurementCase & { transfer_ID: string | null }) | undefined;
  if (!item) throw new BusinessError('CASE_NOT_FOUND', 404);
  if (item.version !== expectedVersion) throw new BusinessError('STALE_VERSION', 409);
  if (item.status !== 'Approved' || !item.transfer_ID) throw new BusinessError('TRANSFER_NOT_AVAILABLE', 409);
  const job = await tx.run(SELECT.one.from('procurement.Transfers').where({ ID: item.transfer_ID, procurementCase_ID: id })) as
    { ID: string; status: string; version: number; submission_ID: string } | undefined;
  if (!job || job.submission_ID !== item.currentSubmission_ID) throw new BusinessError('TRANSFER_NOT_AVAILABLE', 409);
  if (job.status === 'Pending') return item;
  if (!['Retry','Failed'].includes(job.status)) throw new BusinessError('TRANSFER_BUSY', 409);
  const changed = await tx.run(UPDATE.entity('procurement.Transfers').set({ status: 'Pending',
    version: job.version + 1, failureCount: 0, nextAttemptAt: new Date().toISOString(),
    lastErrorCode: null, lastErrorMessage: null }).where({ ID: job.ID, status: job.status, version: job.version }));
  if (changed !== 1) throw new BusinessError('TRANSFER_BUSY', 409);
  return item;
}
