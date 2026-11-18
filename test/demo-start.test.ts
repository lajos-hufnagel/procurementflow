import assert from 'node:assert/strict';
import { it } from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const CASE = '50000000-0000-4000-8000-000000000001';
const auth = (user: string) => ({ Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64') });
it('M4: demo launcher owns both services, preserves their databases and exposes local fault controls', async () => {
  const database = resolve(root, '.local', `launcher-${randomUUID()}.sqlite`);
  const erpDatabase = resolve(root, 'erp/.local', `launcher-${randomUUID()}.sqlite`);
  const env = { ...process.env, NODE_ENV: 'development', PORT: '0', ERP_PORT: '0',
    cds_requires_db_credentials_url: database, ERP_DB_FILE: erpDatabase,
    ERP_WORKER_INTERVAL_MS: '100', ERP_MAX_ATTEMPTS: '1' };
  async function start() {
    const child = spawn(process.execPath, ['scripts/demo.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    const stop = async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 7000);
      try { await exited; assert.equal(child.exitCode, 0, output); } finally { clearTimeout(deadline); }
    };
    try {
      const urls = await new Promise<{ main: string; erp: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Demo startup timed out: ' + output)), 15000);
        child.stdout.on('data', chunk => {
          output += chunk;
          const match = /ProcurementFlow: (http\S+)\s+ERP test service: (http\S+)\/erp\/Orders/.exec(output);
          if (match) { clearTimeout(timer); resolve({ main: match[1]!, erp: match[2]! }); }
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Demo exited ${code}: ${output}`)); });
      });
      return { ...urls, stop };
    } catch (error) { await stop(); throw error; }
  }
  let demo: Awaited<ReturnType<typeof start>> | undefined;
  const request = async (path: string, data?: object, user = 'reader') => {
    const response = await fetch(demo!.main + '/procurement/' + path, { method: data ? 'POST' : 'GET',
      headers: { ...auth(user), 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(3000) });
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  const action = (name: string, version: number, user: string, fields = {}) => request(
    `Cases(${CASE})/ProcurementService.${name}`, { expectedVersion: version, ...fields }, user);
  const wait = async (path: string, status: string) => {
    let result: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      result = await request(path); if (result.status === status) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(result.status, status, JSON.stringify(result)); return result;
  };
  try {
    demo = await start();
    await promisify(execFile)(process.execPath, ['scripts/erp-mode.mjs', 'unavailable'], {
      cwd: root, env: { ...process.env, NODE_ENV: 'development', ERP_PORT: new URL(demo.erp).port }
    });
    await action('prepare', 0, 'buyer', { offerID: '40000000-0000-4000-8000-000000000002', reason: 'Terminsicherung', extraCostReason: 'Fertigung versorgen' });
    await action('submit', 1, 'buyer'); const approved = await action('approve', 2, 'approver');
    const failed = await wait(`Transfers(${approved.transfer_ID})`, 'Failed');
    assert.equal(failed.lastErrorCode, 'ERP_UNAVAILABLE');
    const old = demo;
    await demo.stop();
    await assert.rejects(fetch(old.main + '/app-config', { signal: AbortSignal.timeout(500) }));
    await assert.rejects(fetch(old.erp + '/erp/Orders', { headers: auth('integration'), signal: AbortSignal.timeout(500) }));
    demo = await start();
    assert.equal((await request(`Cases(${CASE})`)).status, 'Approved');
    assert.equal((await request(`Transfers(${failed.ID})`)).payloadHash, failed.payloadHash);
    await action('retryTransfer', 3, 'buyer');
    const ordered = await wait(`Cases(${CASE})`, 'Ordered');
    const response = await fetch(demo.erp + '/erp/Orders', { headers: auth('integration'), signal: AbortSignal.timeout(3000) });
    const orders = await response.json() as Record<string, any>[];
    assert.equal(orders.length, 1); assert.equal(orders[0]!.orderNumber, ordered.orderNumber);
  } finally {
    await demo?.stop();
    for (const file of [database, erpDatabase]) await Promise.all([file, file+'-wal', file+'-shm'].map(path => rm(path, { force: true })));
  }
});
