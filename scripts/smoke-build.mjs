import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { startProject } from './project-process.mjs';

const root = resolve(import.meta.dirname, '..');
const database = resolve(root, '.local', `build-smoke-${randomUUID()}.sqlite`);
const erpDatabase = resolve(root, 'erp/.local', `build-smoke-${randomUUID()}.sqlite`);
const env = { ...process.env, NODE_ENV: 'development', cds_requires_db_credentials_url: database };
const erpEnv = { ...env, cds_requires_db_credentials_url: erpDatabase, ERP_DEMO_MODE: 'drop-after-commit-once' };
let main, erp;
try {
  await promisify(execFile)(process.execPath, [resolve(root, 'test/fixtures/compiled-database.mjs')], { cwd: resolve(root, 'gen/srv'), env });
  await promisify(execFile)(process.execPath, ['scripts/seed-demo.mjs'], { cwd: resolve(root, 'gen/srv'), env });
  await assert.rejects(promisify(execFile)(process.execPath, ['scripts/seed-demo.mjs'], { cwd: resolve(root, 'gen/srv'), env }), /requires empty business tables/);
  await promisify(execFile)(process.execPath, [resolve(root, 'scripts/database.mjs'), 'init'], { cwd: resolve(root, 'erp'), env: erpEnv });
  erp = await startProject({ cwd: resolve(root, 'gen/erp'), env: erpEnv });
  main = await startProject({ cwd: resolve(root, 'gen/srv'), env: { ...env,
    ERP_WORKER_ENABLED: 'true', ERP_BASE_URL: erp.url, ERP_WORKER_INTERVAL_MS: '100',
    ERP_MAX_ATTEMPTS: '5', ERP_RETRY_BASE_MS: '100', ERP_RETRY_MAX_MS: '1000' } });
  const base = main.url + '/procurement/';
  const casePath = 'Cases(50000000-0000-4000-8000-000000000001)';
  const auth = user => ({ Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64') });
  const invoke = async (action, user, data, expectedStatus = 200) => {
    const response = await fetch(base + casePath + '/ProcurementService.' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(user) },
      body: JSON.stringify(data), signal: AbortSignal.timeout(3000)
    });
    const body = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    return body;
  };
  const prepared = await invoke('prepare', 'dual', { expectedVersion: 0, offerID: '40000000-0000-4000-8000-000000000002', reason: 'Terminsicherung', extraCostReason: '600 Euro Mehrkosten begründet' });
  assert.equal(prepared.totalCost, '2600.00');
  await invoke('submit', 'dual', { expectedVersion: 1 });
  const forbidden = await invoke('approve', 'dual', { expectedVersion: 2 }, 403);
  assert.equal(forbidden.error.code, 'SELF_APPROVAL');
  const approved = await invoke('approve', 'approver', { expectedVersion: 2 });
  assert.equal(approved.status, 'Approved');
  let ordered;
  for (let i = 0; i < 100; i++) {
    const response = await fetch(base + casePath + '?$expand=transfer', { headers: auth('reader'), signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    ordered = await response.json();
    if (ordered.status === 'Ordered') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ordered.status, 'Ordered', JSON.stringify(ordered));
  assert.equal(ordered.version, 4);
  assert.equal(ordered.transfer.attemptCount, 2);
  const response = await fetch(erp.url + '/erp/Orders', { headers: auth('integration'), signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  const orders = await response.json();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderNumber, ordered.orderNumber);
  assert.match(main.output(), /procurement-service\.js/);
  assert.match(erp.output(), /erp-service\.js/);
  console.log('Kompilierte Initialisierung und Dienste über HTTP geprüft: Vier-Augen-Freigabe, verlorene ERP-Antwort nach Commit, automatische Wiederholung und genau eine bestätigte Bestellung.');
} finally {
  await main?.stop(); await erp?.stop();
  for (const file of [database, erpDatabase]) {
    await Promise.all([file, file + '-wal', file + '-shm'].map(path => rm(path, { force: true })));
  }
}
