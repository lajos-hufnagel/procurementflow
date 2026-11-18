import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { erpDatabase, startErp, removeErpDatabase, erpAuth } from './helpers/erp.ts';
import { payloadHash, type OrderPayload } from '../srv/integration/contract.ts';

let database: string;
let server: Awaited<ReturnType<typeof startErp>>;
const payload: OrderPayload = {
  schemaVersion: 1, operationID: '60000000-0000-4000-8000-000000000001',
  caseID: '50000000-0000-4000-8000-000000000001', caseNumber: 'PF-2026-001',
  submissionID: '60000000-0000-4000-8000-000000000001', revision: 1,
  offerID: '40000000-0000-4000-8000-000000000002', offerVersion: 1, validUntil: '2026-11-21',
  materialID: '10000000-0000-4000-8000-000000000001', supplierID: '20000000-0000-4000-8000-000000000002',
  quantity: 20, unit: 'EA', currency: 'EUR', unitPrice: '125.00', shipping: '100.00', totalCost: '2600.00', deliveryDate: '2026-11-22'
};
async function request(method: string, path: string, body?: unknown, user: string | null = 'integration') {
  const response = await fetch(server.url + '/erp/' + path, { method,
    headers: { 'Content-Type': 'application/json', ...(user ? erpAuth(user) : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, body: data, headers: response.headers };
}
const create = (data: unknown = payload) => request('POST', 'Orders', data);
const orders = async () => (await request('GET', 'Orders')).body as any[];
beforeEach(async () => { database = erpDatabase(); server = await startErp(database); });
afterEach(async () => { if (server) await server.stop(); if (database) await removeErpDatabase(database); });

describe('M4: isolated REST ERP with persistent idempotency', () => {
  it('stores one order and returns the same confirmation for normalized repetitions', async () => {
    const first = await create();
    assert.equal(first.status, 201, JSON.stringify(first));
    assert.equal(first.headers.get('odata-version'), null);
    assert.equal(first.body.payloadHash, payloadHash(payload));
    assert.match(first.body.orderNumber, /^SIM-[A-F0-9]{32}$/);
    const repeated = await create({ ...Object.fromEntries(Object.entries(payload).reverse()), unitPrice: 125, shipping: '100', totalCost: 2600 });
    assert.equal(repeated.status, 201, JSON.stringify(repeated));
    assert.equal(repeated.body.orderNumber, first.body.orderNumber);
    assert.equal(repeated.body.payloadHash, first.body.payloadHash);
    assert.equal((await orders()).length, 1);
  });
  it('persists the order through restart and rejects conflicting data for the same operation', async () => {
    const first = await create();
    assert.equal(first.status, 201, JSON.stringify(first));
    await server.stop(); server = await startErp(database);
    const repeated = await create();
    assert.equal(repeated.body.orderNumber, first.body.orderNumber);
    const conflict = await create({ ...payload, deliveryDate: '2026-11-23' });
    assert.equal(conflict.status, 409, JSON.stringify(conflict));
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await orders()).length, 1);
    assert.equal((await orders())[0].deliveryDate, payload.deliveryDate);
  });
  it('commits before losing the reply and replays that same order after restart', async () => {
    const mode = await request('POST', 'simulate', { mode: 'drop-after-commit-once' }, 'erp-admin');
    assert.equal(mode.status, 200, JSON.stringify(mode));
    await assert.rejects(create(), /fetch failed/);
    assert.equal((await orders()).length, 1);
    const stored = (await orders())[0];
    await server.stop(); server = await startErp(database);
    const repeated = await create();
    assert.equal(repeated.status, 201);
    assert.equal(repeated.body.orderNumber, stored.orderNumber);
    assert.equal((await orders()).length, 1);
  });
  it('handles simultaneous identical and conflicting calls without duplicates', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => create()));
    assert.ok(responses.every(r => r.status === 201), JSON.stringify(responses));
    assert.equal(new Set(responses.map(r => r.body.orderNumber)).size, 1);
    const races = await Promise.all([create(), create({ ...payload, quantity: 21, totalCost: '2725.00' })]);
    assert.deepEqual(races.map(r => r.status).sort(), [201, 409]);
    assert.equal((await orders()).length, 1);
  });
  it('rejects invalid totals, quantities, dates and missing caller-owned operation IDs', async () => {
    for (const change of [{ totalCost: '2600.01' }, { quantity: 0 }, { deliveryDate: '2026-02-30' }, { unitPrice: '-1.00' }, { operationID: null }, { schemaVersion: 2 }]) {
      const result = await create({ ...payload, ...change });
      assert.equal(result.status, 400, JSON.stringify(result));
    }
    const { operationID: _ignored, ...withoutID } = payload;
    assert.equal((await create(withoutID)).status, 400);
    assert.equal((await orders()).length, 0);
  });
  it('fingerprints public-session metadata and expires only marked visitor orders', async () => {
    assert.equal((await create()).status, 201);
    const demo = { ...payload, operationID: '60000000-0000-4000-8000-000000000002',
      demoSessionID: '70000000-0000-4000-8000-000000000001', demoExpiresAt: new Date(Date.now() + 3600000).toISOString() };
    const result = await create(demo);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.payloadHash, payloadHash(demo));
    assert.equal((await create(demo)).status, 201);
    assert.equal((await create({ ...demo, demoSessionID: '70000000-0000-4000-8000-000000000002' })).status, 409);
    assert.equal((await create({ ...demo, demoExpiresAt: new Date(Date.now() - 1000).toISOString() })).status, 410);
    assert.equal((await create({ ...demo, demoExpiresAt: new Date(Date.now() + 48 * 3600000).toISOString() })).status, 400);
    const script = `import cds from '@sap/cds';
      import { cleanExpiredDemoOrders } from './srv/lib/demo-cleanup.ts';
      cds.model = cds.linked(await cds.load('*'));
      const db = await cds.connect.to('db');
      try { console.log('REMOVED=' + await cleanExpiredDemoOrders(Date.now() + 2 * 3600000)); }
      finally { await db.disconnect(); }`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      cwd: resolve('erp'), env: { ...process.env, NODE_ENV: 'development', cds_requires_db_credentials_url: database }
    });
    assert.match(stdout, /REMOVED=1/);
    const remaining = await orders();
    assert.equal(remaining.length, 1); assert.equal(remaining[0].operationID, payload.operationID);
  });

  it('enforces technical identity and blocks generic modification and simulation by callers', async () => {
    assert.equal((await request('GET', 'Orders', undefined, null)).status, 401);
    assert.equal((await request('POST', 'Orders', payload, 'buyer')).status, 401);
    assert.equal((await request('POST', 'simulate', { mode: 'unavailable' })).status, 403);
    assert.equal((await create()).status, 201);
    const path = 'Orders/' + payload.operationID;
    assert.equal((await request('PATCH', path, { totalCost: '1.00' })).status, 403);
    assert.equal((await request('DELETE', path)).status, 403);
    assert.equal((await orders()).length, 1);
  });
  it('simulates unavailability without creating an order and recovers explicitly', async () => {
    assert.equal((await request('POST', 'simulate', { mode: 'unavailable' }, 'erp-admin')).status, 200);
    assert.equal((await create()).status, 503);
    assert.equal((await orders()).length, 0);
    assert.equal((await request('POST', 'simulate', { mode: 'available' }, 'erp-admin')).status, 200);
    assert.equal((await create()).status, 201);
    assert.equal((await orders()).length, 1);
  });
});
