import cds from '@sap/cds';
import { publicDemoEnabled } from '../demo/scope.ts';
import { payloadHash, type OrderConfirmation, type OrderPayload } from './contract.ts';
import { TransferError, type OrderTransport } from './transport.ts';

const { SELECT, UPDATE, INSERT } = cds.ql;
const JOBS = 'procurement.Transfers';
const ATTEMPTS = 'procurement.TransferAttempts';
type State = 'Pending' | 'Processing' | 'Retry' | 'Succeeded' | 'Failed';
export interface TransferRow {
  ID: string; procurementCase_ID: string; submission_ID: string; status: State;
  payload: string; payloadHash: string; version: number; attemptCount: number; failureCount: number;
  nextAttemptAt: string | null; claimID: string | null; leaseUntil: string | null;
}
export interface ClaimedTransfer extends TransferRow { claimID: string; leaseUntil: string; }
interface WorkerOptions {
  now?: () => number; leaseMs?: number; maxAttempts?: number; baseRetryMs?: number; maxRetryMs?: number;
}

/** Short database transactions around HTTP, with compare-and-set claims and durable ERP idempotency. */
export class OrderWorker {
  readonly transport: OrderTransport;
  readonly now: () => number;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly baseRetryMs: number;
  readonly maxRetryMs: number;
  constructor(transport: OrderTransport, options: WorkerOptions = {}) {
    this.transport = transport;
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 10000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseRetryMs = options.baseRetryMs ?? 1000;
    this.maxRetryMs = options.maxRetryMs ?? 30000;
    for (const value of [this.leaseMs, this.maxAttempts, this.baseRetryMs, this.maxRetryMs]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid worker configuration.');
    }
  }
  private async transaction<T>(run: (tx: cds.Transaction) => Promise<T>): Promise<T> {
    return await cds.tx({ user: new cds.User('transfer-worker') }, run);
  }

  async claim(id: string): Promise<ClaimedTransfer | undefined> {
    return this.transaction(async tx => {
      const row = await tx.run(SELECT.one.from(JOBS).where({ ID: id })) as TransferRow | undefined;
      if (!row) return;
      const now = new Date(this.now()).toISOString();
      const expired = row.status === 'Processing' && row.leaseUntil != null && row.leaseUntil <= now;
      const waiting = ['Pending','Retry'].includes(row.status) && row.nextAttemptAt != null && row.nextAttemptAt <= now;
      if (!expired && !waiting) return;
      const condition = expired
        ? { ID: id, version: row.version, status: 'Processing', claimID: row.claimID, leaseUntil: { '<=': now } }
        : { ID: id, version: row.version, status: row.status, nextAttemptAt: { '<=': now } };
      const failures = row.failureCount + (expired ? 1 : 0);
      const exhausted = failures >= this.maxAttempts;
      const claimID = exhausted ? null : cds.utils.uuid();
      const leaseUntil = exhausted ? null : new Date(this.now() + this.leaseMs).toISOString();
      const changes = {
        version: row.version + 1, status: exhausted ? 'Failed' : 'Processing', claimID, leaseUntil,
        nextAttemptAt: null, attemptCount: row.attemptCount + (exhausted ? 0 : 1), failureCount: failures,
        ...(expired ? { lastErrorCode: 'LEASE_EXPIRED', lastErrorMessage: 'The previous transfer attempt did not finish within its lease.' } : {}),
        ...(exhausted ? {} : { lastAttemptAt: now })
      };
      if (await tx.run(UPDATE.entity(JOBS).set(changes).where(condition)) !== 1) return;
      if (expired) await tx.run(UPDATE.entity(ATTEMPTS).set({ finishedAt: now, outcome: 'LeaseExpired', errorCode: 'LEASE_EXPIRED' })
        .where({ ID: row.claimID, transfer_ID: id, outcome: 'Processing' }));
      if (exhausted) return;
      await tx.run(INSERT.into(ATTEMPTS).entries({ ID: claimID, transfer_ID: id,
        attemptNumber: changes.attemptCount, startedAt: now, outcome: 'Processing' }));
      return { ...row, ...changes, status: 'Processing', claimID: claimID!, leaseUntil: leaseUntil! };
    });
  }

  async complete(job: ClaimedTransfer, confirmation: OrderConfirmation): Promise<boolean> {
    if (confirmation.operationID !== job.ID || confirmation.payloadHash !== job.payloadHash ||
        typeof confirmation.orderNumber !== 'string' || !/^SIM-[A-F0-9]{32}$/.test(confirmation.orderNumber)) {
      throw new TransferError('INVALID_CONFIRMATION', 'ERP confirmation does not match the submitted operation.', false);
    }
    return this.transaction(async tx => {
      const now = new Date(this.now()).toISOString();
      const claimed = await tx.run(UPDATE.entity(JOBS).set({ status: 'Succeeded', orderNumber: confirmation.orderNumber,
        confirmedAt: now, claimID: null, leaseUntil: null, lastErrorCode: null, lastErrorMessage: null,
        version: job.version + 1 }).where({ ID: job.ID, status: 'Processing', version: job.version,
        claimID: job.claimID, leaseUntil: { '>': now } }));
      if (claimed !== 1) return false;
      const item = await tx.run(SELECT.one.from('procurement.Cases').columns('ID', 'version', 'status', 'currentSubmission_ID', 'transfer_ID')
        .where({ ID: job.procurementCase_ID })) as { ID: string; version: number; status: string; currentSubmission_ID: string; transfer_ID: string } | undefined;
      if (!item || item.status !== 'Approved' || item.currentSubmission_ID !== job.submission_ID || item.transfer_ID !== job.ID) {
        throw new TransferError('CASE_CHANGED', 'The approved case no longer matches this transfer.', false);
      }
      const changed = await tx.run(UPDATE.entity('procurement.Cases').set({ status: 'Ordered', version: item.version + 1,
        orderNumber: confirmation.orderNumber, orderedAt: now }).where({ ID: item.ID, version: item.version,
        status: 'Approved', currentSubmission_ID: job.submission_ID, transfer_ID: job.ID }));
      if (changed !== 1) throw new TransferError('CASE_CHANGED', 'The approved case changed before order confirmation.', false);
      await tx.run(UPDATE.entity(ATTEMPTS).set({ outcome: 'Succeeded', finishedAt: now }).where({ ID: job.claimID, outcome: 'Processing' }));
      await tx.run(INSERT.into('procurement.History').entries({ ID: cds.utils.uuid(), procurementCase_ID: item.ID,
        submission_ID: job.submission_ID, event: 'Ordered', fromStatus: 'Approved', toStatus: 'Ordered',
        caseVersion: item.version + 1, actor: 'transfer-worker', occurredAt: now }));
      return true;
    });
  }

  async fail(job: ClaimedTransfer, error: TransferError): Promise<boolean> {
    return this.transaction(async tx => {
      const nowMs = this.now();
      const now = new Date(nowMs).toISOString();
      const failures = job.failureCount + 1;
      const retry = error.retryable && failures < this.maxAttempts;
      const nextAttemptAt = retry ? new Date(nowMs + Math.min(this.maxRetryMs, this.baseRetryMs * 2 ** Math.min(failures - 1, 20))).toISOString() : null;
      const changed = await tx.run(UPDATE.entity(JOBS).set({ status: retry ? 'Retry' : 'Failed',
        failureCount: failures, version: job.version + 1, nextAttemptAt, claimID: null, leaseUntil: null,
        lastErrorCode: error.code, lastErrorMessage: error.message.slice(0,1000) }).where({
        ID: job.ID, status: 'Processing', version: job.version, claimID: job.claimID, leaseUntil: { '>': now }
      }));
      if (changed !== 1) return false;
      await tx.run(UPDATE.entity(ATTEMPTS).set({ outcome: retry ? 'Retry' : 'Failed', finishedAt: now, errorCode: error.code })
        .where({ ID: job.claimID, outcome: 'Processing' }));
      return true;
    });
  }

  async process(job: ClaimedTransfer, signal?: AbortSignal): Promise<void> {
    try {
      let payload: OrderPayload;
      try {
        payload = JSON.parse(job.payload) as OrderPayload;
        if (payloadHash(payload) !== job.payloadHash || payload.operationID !== job.ID ||
            payload.submissionID !== job.submission_ID || payload.caseID !== job.procurementCase_ID) throw new Error('Mismatching snapshot');
      } catch { throw new TransferError('PAYLOAD_CORRUPTED', 'The stored order snapshot is inconsistent.', false); }
      if (publicDemoEnabled()) {
        // Resolve the persisted case owner for every attempt, including automatic retries after a restart.
        // A scenario change affects future sends; an HTTP request already in flight may still finish.
        const owner = await this.transaction(tx => tx.run(SELECT.one.from('procurement.Cases')
          .columns('demoScope', 'demoSession.erpOutage as erpOutage').where({ ID: job.procurementCase_ID }))) as
          { demoScope: string; erpOutage: boolean } | undefined;
        if (owner?.demoScope !== 'shared' && owner?.erpOutage) {
          throw new TransferError('ERP_DEMO_OUTAGE', 'Demo simulation: ERP is unavailable for this visitor session.', true);
        }
      }
      const reply = await this.transport.send(payload, signal);
      await this.complete(job, reply);
    } catch (error) {
      await this.fail(job, error instanceof TransferError ? error : new TransferError('INTERNAL_TRANSFER_ERROR', 'The transfer could not be finalized.', true));
    }
  }

  async runDue(limit = 5, signal?: AbortSignal): Promise<number> {
    const now = new Date(this.now()).toISOString();
    const rows = await this.transaction(async tx => await tx.run(SELECT.from(JOBS).columns('ID')
      .where`((status in ('Pending', 'Retry') and nextAttemptAt <= ${now}) or (status = 'Processing' and leaseUntil <= ${now})) and (procurementCase.demoScope = 'shared' or procurementCase.demoSession.expiresAt > ${now})`.orderBy('createdAt', 'ID').limit(limit)) as { ID: string }[]);
    let count = 0;
    for (const row of rows) {
      if (signal?.aborted) break;
      const job = await this.claim(row.ID);
      if (!job) continue;
      count++;
      await this.process(job, signal);
    }
    return count;
  }
}
