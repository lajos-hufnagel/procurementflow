import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { OrderWorker, type ClaimedTransfer } from '../srv/integration/worker.ts';
import { HttpOrderTransport, TransferError, type OrderTransport } from '../srv/integration/transport.ts';
import type { OrderPayload } from '../srv/integration/contract.ts';
import { erpDatabase, startErp, removeErpDatabase, erpAuth } from './helpers/erp.ts';

const api = cds.test('serve', '--in-memory') as ReturnType<typeof cds.test> & { url: string };
const CASE = '50000000-0000-4000-8000-000000000001';
const OFFER = '40000000-0000-4000-8000-000000000002';
const { SELECT, UPDATE } = cds.ql;
type Row = Record<string, any>;
let database: string;
let erp: Awaited<ReturnType<typeof startErp>>;
let clock: number;
const options = () => ({ now: () => clock, baseRetryMs: 1000, maxRetryMs: 4000 });
const transport = () => new HttpOrderTransport(erp.url, 'integration', 'demo-integration');
const worker = (remote: OrderTransport = transport()) => new OrderWorker(remote, options());
async function request(path: string, method = 'GET', body?: Row, user = 'buyer') {
  const response = await fetch(api.url + '/procurement/' + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64') },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let data: Row; try { data = JSON.parse(raw); } catch { data = { text: raw }; }
  return { status: response.status, body: data };
}
const action = (name: string, version: number, user = 'buyer', data: Row = {}) => request(
  `Cases(${CASE})/ProcurementService.${name}`, 'POST', { expectedVersion: version, ...data }, user);
async function submit() {
  assert.equal((await action('prepare', 0, 'buyer', { offerID: OFFER, reason: 'Terminsicherung', extraCostReason: 'Fertigung versorgen' })).status, 200);
  assert.equal((await action('submit', 1)).status, 200);
}
async function approve() {
  await submit(); const result = await action('approve', 2, 'approver');
  assert.equal(result.status, 200, JSON.stringify(result));
  return result.body;
}
const state = async () => (await request(`Cases(${CASE})`)).body;
const jobs = async () => await cds.db.run(SELECT.from('procurement.Transfers')) as Row[];
const job = async () => (await jobs())[0]!;
const attempts = async () => await cds.db.run(SELECT.from('procurement.TransferAttempts').orderBy('attemptNumber')) as Row[];
const history = async () => await cds.db.run(SELECT.from('procurement.History').orderBy('caseVersion')) as Row[];
async function orders(): Promise<Row[]> {
  const response = await fetch(erp.url + '/erp/Orders', { headers: erpAuth() });
  assert.equal(response.status, 200); return await response.json() as Row[];
}
async function mode(value: string) {
  const response = await fetch(erp.url + '/erp/simulate', { method: 'POST',
    headers: { ...erpAuth('erp-admin'), 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: value }) });
  assert.equal(response.status, 200);
}
beforeEach(async () => {
  process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-19';
  await api.data.reset(); clock = Date.now() + 10000;
  database = erpDatabase(); erp = await startErp(database);
});
afterEach(async () => { if (erp) await erp.stop(); if (database) await removeErpDatabase(database); });

describe('M4: atomic approval and immutable outbox', () => {
  it('stores one approved snapshot and one job despite simultaneous approval attempts', async () => {
    await submit();
    const results = await Promise.all([action('approve', 2, 'approver'), action('approve', 2, 'approver')]);
    assert.deepEqual(results.map(x => x.status).sort(), [200,409]);
    assert.equal((await jobs()).length, 1);
    const pending = await job();
    const payload = JSON.parse(pending.payload);
    assert.equal(pending.ID, (await state()).currentSubmission_ID);
    assert.equal((await state()).transfer_ID, pending.ID);
    assert.equal(payload.unitPrice, '125.00');
    assert.equal(payload.validUntil, '2026-11-21');
    assert.equal(pending.status, 'Pending');
    assert.equal((await state()).status, 'Approved');
    assert.equal((await state()).orderNumber, null);
    assert.equal((await orders()).length, 0);
  });
  it('rolls approval back when the actual outbox insert fails', async () => {
    await submit();
    await cds.db.run("CREATE TRIGGER fail_outbox BEFORE INSERT ON procurement_Transfers BEGIN SELECT RAISE(ABORT, 'simulated outbox failure'); END");
    try {
      assert.equal((await action('approve', 2, 'approver')).status, 500);
      assert.equal((await state()).status, 'Submitted');
      assert.equal((await state()).version, 2);
      assert.equal((await jobs()).length, 0);
      assert.deepEqual((await history()).map(x => x.event), ['Prepared','Submitted']);
    } finally { await cds.db.run('DROP TRIGGER fail_outbox'); }
    assert.equal((await action('approve', 2, 'approver')).status, 200);
  });
  it('exposes transfer status to readers without allowing generic writes or leaking payload/claims', async () => {
    await approve(); const pending = await job();
    const readable = await request('Transfers', 'GET', undefined, 'reader');
    assert.equal(readable.status, 200);
    assert.equal(readable.body.value[0].status, 'Pending');
    for (const field of ['payload','claimID','leaseUntil']) assert.equal(readable.body.value[0][field], undefined);
    for (const method of ['POST','PATCH','DELETE']) {
      const result = await request(method === 'POST' ? 'Transfers' : `Transfers(${pending.ID})`, method, method === 'DELETE' ? undefined : { status: 'Succeeded' });
      assert.equal(result.status, 403, JSON.stringify(result));
    }
    assert.equal((await action('retryTransfer', 3, 'reader')).status, 403);
    assert.equal((await job()).status, 'Pending');
  });
});

describe('M4: real HTTP delivery and bounded retries', () => {
  it('ignores visitor outage settings outside the explicitly enabled public-demo profile', async () => {
    await approve();
    const id = cds.utils.uuid();
    await cds.db.run(cds.ql.INSERT.into('procurement.DemoSessions').entries({ ID: id, tokenHash: '0'.repeat(64),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), erpOutage: true }));
    await cds.db.run(UPDATE.entity('procurement.Cases').set({ demoScope: id }).where({ ID: CASE }));
    assert.equal(await worker().runDue(), 1);
    assert.equal((await job()).status, 'Succeeded');
    assert.equal((await orders()).length, 1);
  });
  it('orders the frozen approved conditions and records one atomic business confirmation', async () => {
    await approve();
    await cds.db.run(UPDATE.entity('procurement.Offers').set({ unitPrice: '999.00', version: 2 }).where({ ID: OFFER }));
    assert.equal(await worker().runDue(), 1);
    assert.equal((await state()).status, 'Ordered');
    assert.equal((await state()).version, 4);
    assert.equal((await job()).status, 'Succeeded');
    const stored = await orders(); assert.equal(stored.length, 1);
    assert.equal(Number(stored[0]!.unitPrice), 125);
    assert.equal((await state()).orderNumber, stored[0]!.orderNumber);
    assert.equal((await job()).orderNumber, stored[0]!.orderNumber);
    assert.deepEqual((await attempts()).map(x => x.outcome), ['Succeeded']);
    assert.deepEqual((await history()).map(x => x.event), ['Prepared','Submitted','Approved','Ordered']);
    assert.equal(await worker().runDue(), 0);
    assert.equal((await action('retryTransfer', 3)).status, 409);
  });
  it('allows only one current worker to claim the same pending transfer', async () => {
    await approve();
    const counts = await Promise.all([worker().runDue(), worker().runDue()]);
    assert.equal(counts.reduce((a,b) => a+b, 0), 1);
    assert.equal((await attempts()).length, 1);
    assert.equal((await orders()).length, 1);
    assert.equal((await history()).filter(x => x.event === 'Ordered').length, 1);
  });
  it('keeps approval during an outage, respects backoff and recovers without a new operation', async () => {
    await approve(); const id = (await job()).ID;
    await mode('unavailable');
    const service = worker(); await service.runDue();
    assert.equal((await job()).status, 'Retry');
    assert.equal((await job()).lastErrorCode, 'ERP_UNAVAILABLE');
    assert.equal((await state()).status, 'Approved');
    assert.equal((await orders()).length, 0);
    assert.equal(await service.runDue(), 0);
    await mode('available'); clock += 1000;
    assert.equal(await service.runDue(), 1);
    assert.equal((await job()).ID, id);
    assert.equal((await job()).attemptCount, 2);
    assert.equal((await state()).status, 'Ordered');
    assert.equal((await orders()).length, 1);
  });
  it('reuses the committed ERP order after a lost reply and ERP restart', async () => {
    await approve(); await mode('drop-after-commit-once');
    await worker().runDue();
    assert.equal((await job()).status, 'Retry');
    assert.equal((await job()).lastErrorCode, 'ERP_CONNECTION');
    assert.equal((await state()).status, 'Approved');
    const stored = await orders(); assert.equal(stored.length, 1);
    await erp.stop(); erp = await startErp(database); clock += 1000;
    await worker().runDue();
    assert.equal((await state()).status, 'Ordered');
    assert.equal((await state()).orderNumber, stored[0]!.orderNumber);
    assert.equal((await orders()).length, 1);
  });
  it('stops automatic retries after exhaustion and allows an authorized retry of the same snapshot', async () => {
    await approve(); const snapshot = await job(); await mode('unavailable');
    const service = new OrderWorker(transport(), { ...options(), maxAttempts: 2 });
    await service.runDue(); clock += 1000; await service.runDue();
    assert.equal((await job()).status, 'Failed');
    assert.equal((await job()).attemptCount, 2);
    clock += 60000; assert.equal(await service.runDue(), 0);
    assert.equal((await action('retryTransfer', 3, 'approver')).status, 200);
    assert.equal((await action('retryTransfer', 3, 'buyer')).status, 200);
    assert.equal((await job()).ID, snapshot.ID);
    assert.equal((await job()).payload, snapshot.payload);
    assert.equal((await job()).attemptCount, 2);
    await mode('available'); await service.runDue();
    assert.equal((await state()).status, 'Ordered');
    assert.equal((await job()).attemptCount, 3);
    assert.equal((await orders()).length, 1);
  });
  it('treats rejected service credentials as terminal and keeps the approval', async () => {
    await approve(); await worker(new HttpOrderTransport(erp.url, 'integration', 'wrong-password')).runDue();
    assert.equal((await job()).status, 'Failed');
    assert.equal((await job()).lastErrorCode, 'ERP_AUTH');
    assert.equal((await state()).status, 'Approved');
    assert.equal((await orders()).length, 0);
  });
});

describe('M4: abandoned claims and atomic completion', () => {
  it('rejects success and failure from an expired worker even before a new claim', async () => {
    await approve(); const service = worker(); const current = await service.claim((await job()).ID) as ClaimedTransfer;
    const reply = await transport().send(JSON.parse(current.payload));
    clock += service.leaseMs;
    assert.equal(await service.complete(current, reply), false);
    assert.equal(await service.fail(current, new TransferError('ERP_CONNECTION', 'Lost connection.', true)), false);
    assert.equal((await state()).status, 'Approved');
    await service.runDue();
    assert.equal((await state()).status, 'Ordered');
    assert.equal((await orders()).length, 1);
    assert.deepEqual((await attempts()).map(x => x.outcome), ['LeaseExpired','Succeeded']);
  });
  it('never lets an older claim overwrite the result of its replacement', async () => {
    await approve(); const service = worker(); const older = await service.claim((await job()).ID) as ClaimedTransfer;
    const reply = await transport().send(JSON.parse(older.payload));
    clock += service.leaseMs + 1;
    const newer = await service.claim(older.ID) as ClaimedTransfer;
    assert.notEqual(newer.claimID, older.claimID);
    assert.equal((await action('retryTransfer', 3)).body.error.code, 'TRANSFER_BUSY');
    await service.process(newer);
    const before = await job();
    assert.equal(await service.complete(older, reply), false);
    assert.equal(await service.fail(older, new TransferError('ERP_CONNECTION', 'Old failure.', true)), false);
    assert.deepEqual(await job(), before);
    assert.equal((await orders()).length, 1);
    assert.equal((await history()).filter(x => x.event === 'Ordered').length, 1);
  });
  it('rolls back local completion on a history failure and then reuses the existing ERP order', async () => {
    await approve();
    await cds.db.run("CREATE TRIGGER fail_order_history BEFORE INSERT ON procurement_History WHEN NEW.event = 'Ordered' BEGIN SELECT RAISE(ABORT, 'simulated history failure'); END");
    const service = worker();
    try {
      await service.runDue();
      assert.equal((await job()).status, 'Retry');
      assert.equal((await state()).status, 'Approved');
      assert.equal((await state()).version, 3);
      assert.equal((await state()).orderNumber, null);
      assert.equal((await orders()).length, 1);
      assert.equal((await history()).filter(x => x.event === 'Ordered').length, 0);
    } finally { await cds.db.run('DROP TRIGGER fail_order_history'); }
    clock += 1000; await service.runDue();
    assert.equal((await state()).status, 'Ordered');
    assert.equal((await orders()).length, 1);
    assert.equal((await history()).filter(x => x.event === 'Ordered').length, 1);
  });
  it('blocks foreign confirmations and tampered stored payloads', async () => {
    await approve();
    const remote: OrderTransport = { async send(payload: OrderPayload) { return { operationID: 'wrong-operation', payloadHash: 'wrong-hash', orderNumber: 'not-an-order' }; } };
    await worker(remote).runDue();
    assert.equal((await job()).lastErrorCode, 'INVALID_CONFIRMATION');
    assert.equal((await state()).status, 'Approved');
    await action('retryTransfer', 3);
    await cds.db.run(UPDATE.entity('procurement.Transfers').set({ payload: '{"changed":true}' }).where({ ID: (await job()).ID }));
    await worker().runDue();
    assert.equal((await job()).lastErrorCode, 'PAYLOAD_CORRUPTED');
    assert.equal((await orders()).length, 0);
  });
  it('bounds repeated abandoned claims as failures instead of retrying forever', async () => {
    await approve(); const service = new OrderWorker(transport(), { ...options(), maxAttempts: 2 });
    const id = (await job()).ID;
    assert.ok(await service.claim(id)); clock += service.leaseMs;
    assert.ok(await service.claim(id)); clock += service.leaseMs;
    assert.equal(await service.claim(id), undefined);
    assert.equal((await job()).status, 'Failed');
    assert.equal((await job()).attemptCount, 2);
    assert.deepEqual((await attempts()).map(x => x.outcome), ['LeaseExpired','LeaseExpired']);
  });
  it('aborts a slow HTTP request and classifies the timeout as retryable', async () => {
    const slow = createServer((_request, response) => { response.on('error', () => {}); });
    slow.listen(0, '127.0.0.1'); await once(slow, 'listening');
    try {
      await approve();
      const port = (slow.address() as { port: number }).port;
      await worker(new HttpOrderTransport(`http://127.0.0.1:${port}`, 'integration', 'demo-integration', 50)).runDue();
      assert.equal((await job()).status, 'Retry');
      assert.equal((await job()).lastErrorCode, 'ERP_TIMEOUT');
      assert.equal((await state()).status, 'Approved');
    } finally { slow.closeAllConnections(); await new Promise<void>((resolve, reject) => slow.close(error => error ? reject(error) : resolve())); }
  });
});
