import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { erpDatabase, startErp, removeErpDatabase } from '../helpers/erp.ts';

const exec = promisify(execFile);
export const CASE = '50000000-0000-4000-8000-000000000001';
export const OFFER_A = '40000000-0000-4000-8000-000000000002';
export const OFFER_B = '40000000-0000-4000-8000-000000000003';
export const active = `DecisionWorkspaces(ID=${CASE},IsActiveEntity=true)`;
export const draft = `DecisionWorkspaces(ID=${CASE},IsActiveEntity=false)`;
export const auth = (user = 'buyer') => ({ Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64') });

export const test = base.extend<{ demoServer: string; browserErrors: string[]; erpMode: string | undefined; erpEndpoint: string | undefined; throughAppRouter: boolean; publicDemo: boolean }>({
  erpMode: [undefined, { option: true }],
  throughAppRouter: [false, { option: true }],
  publicDemo: [false, { option: true }],
  erpEndpoint: async ({ erpMode, publicDemo }, use) => {
    if (publicDemo && process.env.PUBLIC_DEMO_TEST_URL) return use(undefined);
    if (!erpMode) return use(undefined);
    const database = erpDatabase();
    const server = await startErp(database, erpMode, true);
    try {
      expect(server.output).toContain('erp-service.js');
      await use(server.url);
    } finally { await server.stop(); await removeErpDatabase(database); }
  },
  demoServer: async ({ erpEndpoint, publicDemo }, use) => {
    if (publicDemo && process.env.PUBLIC_DEMO_TEST_URL) return use(process.env.PUBLIC_DEMO_TEST_URL);
    await access('gen/srv/app/decisions/webapp/Component-preload.js');
    const file = resolve('.local', `browser-${randomUUID()}.sqlite`);
    const env = { ...process.env, NODE_ENV: 'development', CDS_ENV: publicDemo ? 'public-demo' : '', cds_requires_db_credentials_url: file,
      ERP_WORKER_ENABLED: String(Boolean(erpEndpoint)), ERP_BASE_URL: erpEndpoint,
      ERP_WORKER_INTERVAL_MS: '100', ERP_MAX_ATTEMPTS: '1' };
    await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    const child = fork(resolve('test/fixtures/server.mjs'), [], {
      cwd: resolve('gen/srv'), env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Server startup timed out: ' + output)), 10000);
        child.once('message', (message: { url: string }) => { clearTimeout(timer); resolve(message.url); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
      });
      expect(output).toContain('procurement-service.js');
      await use(url);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
      }
      await Promise.all([file, file + '-wal', file + '-shm'].map(path => rm(path, { force: true })));
    }
  },
  baseURL: async ({ demoServer, throughAppRouter, publicDemo }, use) => {
    if (publicDemo && process.env.PUBLIC_DEMO_TEST_URL) return use(demoServer);
    if (!throughAppRouter) return use(demoServer);
    const child = fork(resolve('test/fixtures/approuter.mjs'), [demoServer, publicDemo ? 'public-demo' : 'authenticated'], {
      env: { ...process.env, NODE_ENV: 'development', XS_APP_LOG_LEVEL: 'error', XS_BIND_ADDRESS: '127.0.0.1' },
      execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('AppRouter startup timed out: ' + output)), 15000);
        child.once('message', (message: { url: string }) => { clearTimeout(timer); resolve(message.url); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`AppRouter exited ${code}: ${output}`)); });
      });
      await use(url);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
      }
    }
  },
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Unhandled errors in the browser').toEqual([]);
  }, { auto: true }]
});
export { expect };
