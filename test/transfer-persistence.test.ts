import assert from 'node:assert/strict';
import { it } from 'node:test';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { erpDatabase, startErp, removeErpDatabase, erpAuth } from './helpers/erp.ts';

const CASE = '50000000-0000-4000-8000-000000000001';
const OFFER = '40000000-0000-4000-8000-000000000002';
const root = resolve(import.meta.dirname, '..');
async function startMain(database: string, erpURL: string, worker: boolean, extraEnv: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env, NODE_ENV: 'development', cds_requires_db_credentials_url: database,
    ERP_BASE_URL: erpURL, ERP_WORKER_ENABLED: String(worker), ERP_USER: 'integration', ERP_PASSWORD: 'demo-integration',
    ERP_WORKER_INTERVAL_MS: '100', ERP_RETRY_BASE_MS: '30000', ERP_RETRY_MAX_MS: '30000', ...extraEnv };
  await promisify(execFile)(process.execPath, ['scripts/database.mjs', 'init'], { cwd: root, env });
  const child = fork(resolve(root, 'test/fixtures/project-server.mjs'), [], { cwd: root, env, execArgv: [], stdio: ['ignore','pipe','pipe','ipc'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk; }); child.stderr?.on('data', chunk => { output += chunk; });
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child,'exit'); child.kill('SIGTERM'); await exit; } };
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Main startup timed out: ' + output)), 10000);
      child.once('message', (message: { url: string }) => { clearTimeout(timer); resolve(message.url); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Main exited ${code}: ${output}`)); });
    });
    return { url, stop };
  } catch (error) { await stop(); throw error; }
}
async function request(base: string, path: string, body?: Record<string, unknown>, user = 'buyer') {
  const response = await fetch(base + '/procurement/' + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64') },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3000) });
  const result = await response.json() as Record<string, any>;
  assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
const action = (base: string, name: string, version: number, user = 'buyer', data = {}) => request(base,
  `Cases(${CASE})/ProcurementService.${name}`, { expectedVersion: version, ...data }, user);
async function approve(base: string) {
  await action(base, 'prepare', 0, 'buyer', { offerID: OFFER, reason: 'Terminsicherung', extraCostReason: 'Fertigung versorgen' });
  await action(base, 'submit', 1); return await action(base, 'approve', 2, 'approver');
}
async function eventually(read: () => Promise<Record<string, any>>, status: string) {
  let result: Record<string, any> = {};
  for (let i = 0; i < 125; i++) {
    result = await read(); if (result.status === status) return result;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.equal(result.status, status, JSON.stringify(result)); return result;
}
async function removeMain(file: string) { await Promise.all([file,file+'-wal',file+'-shm'].map(path => rm(path,{force:true}))); }

it('M4: queued approval survives a real main-process restart and is picked up automatically', async () => {
  const database = resolve(root, '.local', `transfer-restart-${randomUUID()}.sqlite`);
  const target = erpDatabase();
  let erp: Awaited<ReturnType<typeof startErp>> | undefined;
  let main: Awaited<ReturnType<typeof startMain>> | undefined;
  try {
    erp = await startErp(target); main = await startMain(database, erp.url, false);
    const approved = await approve(main.url);
    const pending = await request(main.url, `Transfers(${approved.transfer_ID})`);
    assert.equal(pending.status, 'Pending');
    await main.stop(); main = await startMain(database, erp.url, true);
    const base = main.url;
    const ordered = await eventually(() => request(base, `Cases(${CASE})`), 'Ordered');
    assert.equal(ordered.transfer_ID, pending.ID);
    const job = await request(base, `Transfers(${pending.ID})`);
    assert.equal(job.status, 'Succeeded'); assert.equal(job.payloadHash, pending.payloadHash);
    await main.stop(); main = await startMain(database, erp.url, true);
    const persisted = await request(main.url, `Cases(${CASE})`);
    assert.equal(persisted.orderNumber, ordered.orderNumber); assert.equal(persisted.version, 4);
    const response = await fetch(erp.url + '/erp/Orders', { headers: erpAuth() });
    const orders = await response.json() as { orderNumber: string }[];
    assert.equal(orders.length, 1); assert.equal(orders[0]!.orderNumber, ordered.orderNumber);
  } finally { await main?.stop(); await erp?.stop(); await removeMain(database); await removeErpDatabase(target); }
});

it('M4: lost response and restart of both processes retain one ERP order and the same transfer identity', async () => {
  const database = resolve(root, '.local', `transfer-lost-${randomUUID()}.sqlite`);
  const target = erpDatabase();
  let erp: Awaited<ReturnType<typeof startErp>> | undefined;
  let main: Awaited<ReturnType<typeof startMain>> | undefined;
  try {
    erp = await startErp(target, 'drop-after-commit-once'); main = await startMain(database, erp.url, true);
    const approved = await approve(main.url); let base = main.url;
    const retry = await eventually(() => request(base, `Transfers(${approved.transfer_ID})`), 'Retry');
    const response = await fetch(erp.url + '/erp/Orders', { headers: erpAuth() });
    const first = await response.json() as { orderNumber: string }[]; assert.equal(first.length, 1);
    assert.equal((await request(base, `Cases(${CASE})`)).status, 'Approved');
    await main.stop(); await erp.stop();
    erp = await startErp(target); main = await startMain(database, erp.url, true); base = main.url;
    const restored = await request(base, `Transfers(${retry.ID})`);
    assert.equal(restored.status, 'Retry'); assert.equal(restored.attemptCount, 1); assert.equal(restored.payloadHash, retry.payloadHash);
    await action(base, 'retryTransfer', 3, 'approver');
    const ordered = await eventually(() => request(base, `Cases(${CASE})`), 'Ordered');
    assert.equal(ordered.orderNumber, first[0]!.orderNumber);
    const finalResponse = await fetch(erp.url + '/erp/Orders', { headers: erpAuth() });
    assert.equal((await finalResponse.json() as unknown[]).length, 1);
    const finalJob = await request(base, `Transfers(${retry.ID})`);
    assert.equal(finalJob.status, 'Succeeded'); assert.equal(finalJob.attemptCount, 2);
  } finally { await main?.stop(); await erp?.stop(); await removeMain(database); await removeErpDatabase(target); }
});


it('M5: the automatic worker uses the real Cloud SDK destination adapter against local ERP', async () => {
  const database = resolve(root, '.local', `transfer-destination-${randomUUID()}.sqlite`);
  const target = erpDatabase();
  let erp: Awaited<ReturnType<typeof startErp>> | undefined;
  let main: Awaited<ReturnType<typeof startMain>> | undefined;
  try {
    erp = await startErp(target);
    main = await startMain(database, 'http://127.0.0.1:1', true, {
      ERP_TRANSPORT: 'destination', ERP_DESTINATION: 'pf-test-erp',
      destinations: JSON.stringify([{ name: 'pf-test-erp', url: erp.url, authentication: 'BasicAuthentication',
        username: 'integration', password: 'demo-integration', proxyType: 'Internet' }])
    });
    const approved = await approve(main.url);
    const base = main.url;
    const ordered = await eventually(() => request(base, `Cases(${CASE})`), 'Ordered');
    const job = await request(base, `Transfers(${approved.transfer_ID})`);
    assert.equal(job.status, 'Succeeded'); assert.equal(job.attemptCount, 1);
    const response = await fetch(erp.url + '/erp/Orders', { headers: erpAuth() });
    const orders = await response.json() as { orderNumber: string }[];
    assert.equal(orders.length, 1); assert.equal(orders[0]!.orderNumber, ordered.orderNumber);
  } finally { await main?.stop(); await erp?.stop(); await removeMain(database); await removeErpDatabase(target); }
});
