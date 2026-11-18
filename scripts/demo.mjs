import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { startProject } from './project-process.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('The local demo launcher is disabled in production.');
const root = resolve(import.meta.dirname, '..');
const erpRoot = resolve(root, 'erp');
const env = { ...process.env, NODE_ENV: 'development' };
const erpEnv = { ...env, cds_requires_db_credentials_url: process.env.ERP_DB_FILE ?? '.local/erp.sqlite' };
const run = promisify(execFile);
const children = [];
let stopping = false;
function own(project) {
  children.push(project);
  project.child.once('exit', () => {
    if (!stopping) { console.error('A demo service exited; stopping both services.'); void stop(1); }
  });
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const project of [...children].reverse()) await project.stop();
  process.exitCode = code;
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
try {
  for (const [cwd, projectEnv] of [[root, env], [erpRoot, erpEnv]]) {
    const result = await run(process.execPath, [resolve(root, 'scripts/database.mjs'), 'init'], { cwd, env: projectEnv });
    process.stdout.write(result.stdout);
  }
  if (!stopping) {
    const erp = await startProject({ cwd: erpRoot, env: erpEnv, port: process.env.ERP_PORT ?? 4005, inheritOutput: true });
    own(erp);
    if (stopping) await erp.stop();
    else {
      const main = await startProject({ cwd: root,
        env: { ...env, ERP_WORKER_ENABLED: 'true', ERP_BASE_URL: erp.url },
        port: process.env.PORT ?? 4004, inheritOutput: true });
      own(main);
      if (stopping) await main.stop();
      else {
        console.log(`\nProcurementFlow: ${main.url}\nERP test service: ${erp.url}/erp/Orders\nStop: Ctrl+C (both services).`);
      }
    }
  }
} catch (error) {
  console.error(error.message);
  await stop(1);
}
