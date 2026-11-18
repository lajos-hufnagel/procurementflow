import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DestinationOrderTransport } from '../srv/integration/destination-transport.ts';
import { TransferError } from '../srv/integration/transport.ts';
import { payloadHash, type OrderPayload } from '../srv/integration/contract.ts';
import { erpDatabase, startErp, removeErpDatabase, erpAuth } from './helpers/erp.ts';

const payload: OrderPayload = {
  schemaVersion: 1, operationID: '60000000-0000-4000-8000-000000000001',
  caseID: '50000000-0000-4000-8000-000000000001', caseNumber: 'PF-2026-001',
  submissionID: '60000000-0000-4000-8000-000000000001', revision: 1,
  offerID: '40000000-0000-4000-8000-000000000002', offerVersion: 1, validUntil: '2026-11-21',
  materialID: '10000000-0000-4000-8000-000000000001', supplierID: '20000000-0000-4000-8000-000000000002',
  quantity: 20, unit: 'EA', currency: 'EUR', unitPrice: '125.00', shipping: '100.00', totalCost: '2600.00', deliveryDate: '2026-11-22'
};
const originalDestinations = process.env.destinations;
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop();
  if (originalDestinations === undefined) delete process.env.destinations;
  else process.env.destinations = originalDestinations;
});
function transport(url: string, timeout = 2000, password = 'demo-integration') {
  const name = 'pf-test-' + randomUUID();
  process.env.destinations = JSON.stringify([{ name, url, type: 'HTTP', proxyType: 'Internet',
    authentication: 'BasicAuthentication', username: 'integration', password }]);
  return new DestinationOrderTransport(name, timeout);
}
async function erp(mode = 'available') {
  const database = erpDatabase();
  cleanup.push(() => removeErpDatabase(database));
  const service = await startErp(database, mode);
  cleanup.push(service.stop);
  return service;
}
async function http(handler: RequestListener) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }));
  return 'http://127.0.0.1:' + (server.address() as { port: number }).port;
}
function failure(code: string, retryable: boolean) {
  return (error: unknown) => error instanceof TransferError && error.code === code && error.retryable === retryable;
}

describe('M5: real SAP Cloud SDK with explicitly local environment destinations', () => {
  it('uses technical Basic authentication, replays the same ERP order and rejects conflicting payloads', async () => {
    const server = await erp(); const adapter = transport(server.url);
    const first = await adapter.send(payload);
    assert.equal(first.payloadHash, payloadHash(payload));
    assert.equal((await adapter.send(payload)).orderNumber, first.orderNumber);
    await assert.rejects(adapter.send({ ...payload, deliveryDate: '2026-11-23' }), failure('ERP_CONFLICT', false));
    const response = await fetch(server.url + '/erp/Orders', { headers: erpAuth() });
    assert.equal((await response.json() as unknown[]).length, 1);
  });
  it('classifies denied technical credentials as a terminal authentication error', async () => {
    const server = await erp();
    await assert.rejects(transport(server.url, 2000, 'wrong-password').send(payload), failure('ERP_AUTH', false));
  });
  it('does not internally repeat a POST after losing a committed ERP response', async () => {
    const server = await erp('drop-after-commit-once'); const adapter = transport(server.url);
    await assert.rejects(adapter.send(payload), failure('ERP_CONNECTION', true));
    const response = await fetch(server.url + '/erp/Orders', { headers: erpAuth() });
    const orders = await response.json() as { orderNumber: string }[];
    assert.equal(orders.length, 1);
    assert.equal((await adapter.send(payload)).orderNumber, orders[0]!.orderNumber);
    const finalResponse = await fetch(server.url + '/erp/Orders', { headers: erpAuth() });
    assert.equal((await finalResponse.json() as unknown[]).length, 1);
  });
  it('sends exactly one fixed-path POST per attempt and never retries HTTP 503 inside the SDK', async () => {
    const calls: string[] = [];
    const url = await http((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      assert.equal(request.headers.authorization, erpAuth().Authorization);
      request.resume(); response.writeHead(503).end('{}');
    });
    await assert.rejects(transport(url).send(payload), failure('ERP_UNAVAILABLE', true));
    await delay(50); assert.deepEqual(calls, ['POST /erp/Orders']);
  });
  it('does not follow redirects to a different path or forward credentials there', async () => {
    let unexpected = 0; let posts = 0;
    const redirected = await http((request, response) => { unexpected++; request.resume(); response.end('{}'); });
    const url = await http((request, response) => { posts++; request.resume(); response.writeHead(307, { Location: redirected + '/other' }).end(); });
    await assert.rejects(transport(url).send(payload), failure('ERP_REJECTED', false));
    assert.equal(posts, 1); assert.equal(unexpected, 0);
  });
  it('aborts an actual stalled HTTP request within its deadline', async () => {
    let posts = 0;
    const url = await http(request => { posts++; request.resume(); });
    const started = performance.now();
    await assert.rejects(transport(url, 150).send(payload), failure('ERP_TIMEOUT', true));
    assert.equal(posts, 1); assert.ok(performance.now() - started < 2000);
  });
  it('rejects malformed confirmations instead of confirming the order', async () => {
    for (const reply of ['not-json', '[]', 'null']) {
      const url = await http((request, response) => { request.resume(); response.end(reply); });
      await assert.rejects(transport(url).send(payload), failure('INVALID_CONFIRMATION', false));
    }
  });
  it('bounds slow destination lookup and never starts a late POST after timeout or cancellation', async () => {
    let posts = 0;
    const url = await http((request, response) => { posts++; request.resume(); response.end('{}'); });
    const resolver = async () => { await delay(150); return { url, type: 'HTTP' as const }; };
    await assert.rejects(new DestinationOrderTransport('pf-slow', 30, resolver).send(payload), failure('ERP_TIMEOUT', true));
    const controller = new AbortController();
    const pending = new DestinationOrderTransport('pf-cancel', 2000, resolver).send(payload, controller.signal);
    controller.abort();
    await assert.rejects(pending, failure('ERP_CONNECTION', true));
    await delay(200); assert.equal(posts, 0);
  });
  it('distinguishes missing, invalid and unavailable destination configuration', async () => {
    await assert.rejects(new DestinationOrderTransport('pf-none', 2000, async () => null).send(payload), failure('ERP_DESTINATION_MISSING', false));
    for (const destination of [{}, { url: 'ftp://example.invalid' }, { url: 'http://user:secret@example.invalid' }, { url: 'http://example.invalid', type: 'RFC' as const }]) {
      await assert.rejects(new DestinationOrderTransport('pf-invalid', 2000, async () => destination).send(payload), failure('ERP_DESTINATION_INVALID', false));
    }
    await assert.rejects(new DestinationOrderTransport('pf-down', 2000, async () => { throw new Error('Lookup unavailable'); }).send(payload), failure('ERP_DESTINATION_UNAVAILABLE', true));
  });
});
