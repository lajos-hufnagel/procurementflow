import { fork } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

/** Own exactly one CAP child, including startup failure and shutdown. */
export async function startProject({ cwd, env, port = 0, inheritOutput = false }) {
  const child = fork(resolve(import.meta.dirname, 'serve-project.mjs'), [String(port)], {
    cwd, env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; if (inheritOutput) process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { output += chunk; if (inheritOutput) process.stderr.write(chunk); });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exit; } finally { clearTimeout(deadline); }
  };
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CAP startup timed out: ' + output)), 15000);
      child.once('message', message => { clearTimeout(timer); resolve(message.url); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`CAP exited ${code}: ${output}`)); });
    });
    return { child, url, stop, output: () => output };
  } catch (error) { await stop(); throw error; }
}
