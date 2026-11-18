import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { it } from 'node:test';

const exec = promisify(execFile);
const CASE = '50000000-0000-4000-8000-000000000001';
const OFFER = '40000000-0000-4000-8000-000000000002';
const file = resolve('.local', `test-${randomUUID()}.sqlite`);
const env = { ...process.env, NODE_ENV: 'development', cds_requires_db_credentials_url: file };

async function start() {
  const child = fork(resolve('test/fixtures/server.mjs'), [], {
    env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Server startup timed out: ' + output)); }, 10000);
    child.once('message', (message: unknown) => {
      clearTimeout(timeout);
      resolve((message as { url: string }).url);
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
  });
  return { child, url };
}
async function stop(child?: ChildProcess) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
}
async function request(url: string, path: string, user = 'buyer', body?: Record<string, unknown>, method = body ? 'POST' : 'GET', expectedStatus = 200) {
  const response = await fetch(url + '/procurement/' + path, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64'), 'Content-Type': 'application/json', 'If-Match': '*' },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  assert.equal(response.status, expectedStatus, `${path}: ${raw}`);
  return JSON.parse(raw) as Record<string, any>;
}

it('M1-08/M2: preserves draft and approval through real process restarts and resets only explicitly', { timeout: 30000 }, async () => {
  let running: Awaited<ReturnType<typeof start>> | undefined;
  try {
    await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    running = await start();
    const action = (name: string) => `Cases(${CASE})/ProcurementService.${name}`;
    const workspace = `DecisionWorkspaces(ID=${CASE},IsActiveEntity=true)`;
    const draft = `DecisionWorkspaces(ID=${CASE},IsActiveEntity=false)`;
    await request(running.url, workspace + '/ProcurementService.draftEdit', 'buyer', { PreserveChanges: true }, 'POST', 201);
    await request(running.url, draft, 'buyer', { selectedOffer_ID: OFFER, reason: 'Terminsicherung', extraCostReason: '600 Euro Mehrkosten akzeptieren' }, 'PATCH');
    const draftBefore = await request(running.url, draft);
    await stop(running.child);
    running = await start();
    const draftRestored = await request(running.url, draft);
    assert.equal(draftRestored.reason, draftBefore.reason);
    assert.equal(draftRestored.baseCaseVersion, 0);
    assert.equal(draftRestored.selectedOffer_ID, OFFER);
    assert.equal((await request(running.url, `Cases(${CASE})`)).version, 0);
    await request(running.url, draft + '/ProcurementService.draftActivate', 'buyer', {});
    await request(running.url, action('submit'), 'buyer', { expectedVersion: 1 });
    const approved = await request(running.url, action('approve'), 'approver', { expectedVersion: 2 });
    const historyBefore = await request(running.url, 'History?$orderby=caseVersion');
    await stop(running.child);
    const initAgain = await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    assert.match(initAgain.stdout, /Keeping existing database:/);
    running = await start();
    const restored = await request(running.url, `Cases(${CASE})`);
    assert.equal(restored.status, 'Approved');
    assert.equal(restored.version, approved.version);
    assert.equal(restored.currentSubmission_ID, approved.currentSubmission_ID);
    assert.deepEqual((await request(running.url, 'History?$orderby=caseVersion')).value, historyBefore.value);
    assert.equal((await request(running.url, 'Submissions')).value.length, 1);
    await stop(running.child);
    await exec(process.execPath, ['scripts/database.mjs', 'reset'], { env });
    running = await start();
    const reset = await request(running.url, `Cases(${CASE})`);
    assert.equal(reset.status, 'Open');
    assert.equal(reset.version, 0);
    assert.equal((await request(running.url, 'History')).value.length, 0);
    assert.equal((await request(running.url, 'Submissions')).value.length, 0);
    await assert.rejects(exec(process.execPath, ['scripts/database.mjs', 'reset'], {
      env: { ...env, NODE_ENV: 'production' }
    }), /disabled in production/);
  } finally {
    await stop(running?.child);
    await Promise.all([file, file + '-wal', file + '-shm'].map(path => rm(path, { force: true })));
  }
});
