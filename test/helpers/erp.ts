import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
export const erpProject = resolve(root, 'erp');
export function erpDatabase(): string { return resolve(erpProject, '.local', `test-${randomUUID()}.sqlite`); }
export async function startErp(database: string, mode = 'available', compiled = false) {
  const env = { ...process.env, NODE_ENV: 'development', ERP_DEMO_MODE: mode, cds_requires_db_credentials_url: database };
  await promisify(execFile)(process.execPath, [resolve(root, 'scripts/database.mjs'), 'init'], { cwd: erpProject, env });
  const child = fork(resolve(root, 'test/fixtures/project-server.mjs'), [], { cwd: compiled ? resolve(root, 'gen/erp') : erpProject, env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
  };
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ERP startup timed out: ' + output)), 10000);
      child.once('message', (message: { url: string }) => { clearTimeout(timer); resolve(message.url); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`ERP exited ${code}: ${output}`)); });
    });
    return { url, stop, output };
  } catch (error) { await stop(); throw error; }
}
export async function removeErpDatabase(database: string) {
  await Promise.all([database, database + '-wal', database + '-shm'].map(file => rm(file, { force: true })));
}
export const erpAuth = (user = 'integration') => ({ Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64') });
