import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const project = 'procurementflow-check-' + randomUUID().slice(0, 8);
const override = resolve(root, '.local', project + '.yaml');
const env = { ...process.env, COMPOSE_PROJECT_NAME: project, APP_PORT: '0', ERP_PORT: '0' };
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
const exec = promisify(execFile);
const compose = async (args, cleanup = false) => {
  const operation = exec('docker', ['compose', '-p', project, '-f', 'compose.yaml', '-f', override, ...args],
    { cwd: root, env, maxBuffer: 16 * 1024 * 1024, ...(cleanup ? {} : { signal: abort.signal }) });
  if (args[0] === 'up') {
    operation.child.stdout?.on('data', chunk => process.stdout.write(chunk));
    operation.child.stderr?.on('data', chunk => process.stderr.write(chunk));
  }
  return (await operation).stdout.trim();
};
const auth = user => ({ Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64') });
let app, erp;
async function request(base, path, user, data, expected = 200) {
  const response = await fetch(base + path, { method: data ? 'POST' : 'GET',
    headers: { ...auth(user), 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(4000)]) });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
const read = path => request(app, '/procurement/' + path, 'reader');
const action = (id, name, user, version, data = {}, status = 200) => request(app,
  `/procurement/Cases(${id})/ProcurementService.${name}`, user, { expectedVersion: version, ...data }, status);
const mode = mode => request(erp, '/erp/simulate', 'erp-admin', { mode });
const orders = () => request(erp, '/erp/Orders', 'integration');
async function until(path, status) {
  let value;
  for (let i = 0; i < 100; i++) {
    value = await read(path); if (value.status === status) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(value.status, status, JSON.stringify(value)); return value;
}
async function urls() {
  app = 'http://' + await compose(['port', 'cap', '4004']);
  erp = 'http://' + await compose(['port', 'erp', '4005']);
}
async function recreate() {
  await compose(['down', '--timeout', '15']); // Keep this test project's own volumes.
  await compose(['up', '-d', '--wait', '--wait-timeout', '90', '--no-build']);
  await urls();
}
async function submit(id, offerID) {
  await action(id, 'prepare', 'dual', 0, { offerID, reason: 'Container-Vorführung', extraCostReason: 'Termingerechte Materialversorgung' });
  await action(id, 'submit', 'dual', 1);
  const forbidden = await action(id, 'approve', 'dual', 2, {}, 403);
  assert.equal(forbidden.error.code, 'SELF_APPROVAL');
  return action(id, 'approve', 'approver', 2);
}
await mkdir(resolve(root, '.local'), { recursive: true });
await writeFile(override, 'services:\n  cap:\n    environment:\n      ERP_MAX_ATTEMPTS: "1"\n      ERP_WORKER_INTERVAL_MS: "100"\n');
const started = Date.now();
try {
  console.log('Building and starting two isolated demo containers: ' + project);
  await compose(['up', '-d', '--wait', '--wait-timeout', '120', ...(process.argv.includes('--no-build') ? ['--no-build'] : ['--build'])]);
  await urls();
  assert.equal((await read('cockpitSummary()')).total, 12);
  for (const path of ['/cockpit/webapp/Component-preload.js', '/decisions/webapp/Component-preload.js']) {
    const response = await fetch(app + path, { signal: AbortSignal.timeout(4000) });
    assert.equal(response.status, 200); assert.ok((await response.text()).length > 100);
  }
  const firstID = '50000000-0000-4000-8000-000000000001';
  await mode('unavailable');
  const approved = await submit(firstID, '40000000-0000-4000-8000-000000000002');
  const failed = await until(`Transfers(${approved.transfer_ID})`, 'Failed');
  assert.equal(failed.lastErrorCode, 'ERP_UNAVAILABLE');
  assert.equal((await read(`Cases(${firstID})`)).status, 'Approved');
  assert.equal((await orders()).length, 0);
  await recreate();
  assert.equal((await read(`Transfers(${failed.ID})`)).payloadHash, failed.payloadHash);
  await action(firstID, 'retryTransfer', 'reader', 3, {}, 403);
  await action(firstID, 'retryTransfer', 'buyer', 3);
  const firstOrder = await until(`Cases(${firstID})`, 'Ordered');
  assert.equal((await orders()).length, 1);
  const secondID = '50000000-0000-4000-8000-000000000002';
  const compared = await read(`Cases(${secondID})/ProcurementService.compareOffers()`);
  const choice = compared.offers.find(row => row.available && !row.isReference);
  assert.ok(choice);
  await mode('drop-after-commit-once');
  const second = await submit(secondID, choice.ID);
  const lost = await until(`Transfers(${second.transfer_ID})`, 'Failed');
  assert.equal(lost.lastErrorCode, 'ERP_CONNECTION');
  const beforeRestart = await orders(); assert.equal(beforeRestart.length, 2);
  const existing = beforeRestart.find(row => row.operationID === second.transfer_ID); assert.ok(existing);
  await recreate();
  assert.equal((await read(`Cases(${firstID})`)).orderNumber, firstOrder.orderNumber);
  assert.equal((await read(`Cases(${secondID})`)).status, 'Approved');
  await action(secondID, 'retryTransfer', 'approver', 3);
  const secondOrder = await until(`Cases(${secondID})`, 'Ordered');
  assert.equal(secondOrder.orderNumber, existing.orderNumber);
  assert.equal((await orders()).length, 2);
  const report = { result: 'passed', durationMs: Date.now() - started, cases: 12, orders: 2,
    fourEyesEnforced: true, readerRetryDenied: true, outageRecovered: true, replyLossRecovered: true,
    volumesSurviveRecreation: true, capImage: await compose(['images', '-q', 'cap']), erpImage: await compose(['images', '-q', 'erp']) };
  await writeFile(resolve(root, '.local/container-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  try { console.error(await compose(['logs', '--no-color', '--tail', '80'], true)); } catch {}
  throw error;
} finally {
  await compose(['down', '--volumes', '--remove-orphans', '--timeout', '15'], true);
  await rm(override, { force: true });
}
