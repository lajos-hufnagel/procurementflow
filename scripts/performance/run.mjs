import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import os from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const extraCases = Number(option('--cases', '20000'));
const samples = Number(option('--samples', '200'));
const label = option('--label', 'measurement');
assert.ok(Number.isSafeInteger(extraCases) && extraCases >= 100 && extraCases <= 100000);
assert.ok(Number.isSafeInteger(samples) && samples >= 10 && samples <= 10000);
assert.match(label, /^[a-z0-9-]{1,60}$/);
await mkdir(resolve(root, '.local/performance'), { recursive: true });
const database = resolve(root, '.local', `performance-${randomUUID()}.sqlite`);
const env = { ...process.env, NODE_ENV: 'development', cds_requires_db_credentials_url: database,
  PROCUREMENT_EVALUATION_DATE: '2026-11-19', ERP_WORKER_ENABLED: 'false' };
const execute = promisify(execFile);
const abort = new AbortController();
const cancel = () => abort.abort(new Error('Performance run cancelled.'));
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
let child;
let output = '';
try {
  await execute(process.execPath, ['scripts/performance/dataset.mjs', String(extraCases)], { cwd: root, env, signal: abort.signal, maxBuffer: 8 * 1024 * 1024 });
  const dataset = JSON.parse(await readFile(database + '.json', 'utf8'));
  const databaseBytes = (await stat(database)).size;
  child = fork(resolve(root, 'scripts/performance/server.mjs'), [], {
    cwd: resolve(root, 'gen/srv'), env, execArgv: [], stdio: ['ignore','pipe','pipe','ipc']
  });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Performance server startup timed out: ' + output)), 15000);
    child.on('message', message => { if (message.type === 'ready') { clearTimeout(timeout); resolve(message.url + '/procurement/'); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Performance server exited ${code}: ${output}`)); });
  });
  let metricID = 0;
  const metrics = reset => new Promise((resolve, reject) => {
    const id = ++metricID;
    const listener = message => { if (message.type === 'metrics' && message.id === id) { clearTimeout(timeout); child.off('message', listener); resolve(message); } };
    const timeout = setTimeout(() => { child.off('message', listener); reject(new Error('Metric collection timed out.')); }, 3000);
    child.on('message', listener); child.send({ type: 'metrics', id, reset });
  });
  const caseID = n => `90000005-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  const scenarios = [
    { name: 'offerComparison', path: i => `Cases(${caseID(1 + (i * 997) % extraCases)})/ProcurementService.compareOffers()`,
      check: (body, i) => { assert.equal(body.caseID, caseID(1 + (i * 997) % extraCases)); assert.equal(body.caseVersion, 0);
        assert.equal(body.offers.length, 3); assert.deepEqual(body.offers.map(offer => offer.totalCost).sort(), ['2000.00','2250.00','2600.00']); } },
    { name: 'cockpitSummary', path: () => 'cockpitSummary()',
      check: body => { assert.equal(body.total, dataset.counts.Cases); assert.equal(body.open, dataset.counts.Cases); assert.equal(body.urgent, dataset.urgent); } },
    { name: 'caseList', path: () => 'Cases?' + new URLSearchParams({ '$top':'6', '$count':'true', '$orderby':'caseNumber',
        '$select':'ID,caseNumber,title,status,referenceDeliveryDate', '$expand':'demand($expand=material),statusInfo,selectedOffer($expand=supplier),transfer($expand=statusInfo)' }),
      check: body => { assert.equal(body['@odata.count'], dataset.counts.Cases); assert.equal(body.value.length, 6); } }
  ];
  const results = [];
  for (const scenario of scenarios) for (const concurrency of [1, 8]) {
    const request = async i => {
      const started = performance.now();
      const response = await fetch(base + scenario.path(i), { headers: { Authorization: 'Basic ' + Buffer.from('reader:demo-reader').toString('base64'), 'Accept-Language': 'de' }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
      const raw = await response.text(); const latencyMs = performance.now() - started;
      assert.equal(response.status, 200, raw.slice(0, 300));
      const body = JSON.parse(raw); scenario.check(body, i);
      // OData context includes the random local port. Business payload remains comparable.
      delete body['@odata.context'];
      return { latencyMs, bytes: Buffer.byteLength(raw), digest: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
    };
    for (let i = 0; i < 20; i++) await request(i);
    const before = await metrics(true); const started = performance.now();
    const measurements = new Array(samples); let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < samples) { const i = next++; measurements[i] = await request(i); }
    }));
    const durationMs = performance.now() - started; const after = await metrics(false);
    const sorted = measurements.map(row => row.latencyMs).sort((a,b) => a-b);
    const quantile = q => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
    const result = { scenario: scenario.name, concurrency, requests: samples, errors: 0,
      durationMs, requestsPerSecond: samples * 1000 / durationMs, p50Ms: quantile(.5), p95Ms: quantile(.95), maxMs: sorted.at(-1),
      meanResponseBytes: measurements.reduce((sum, row) => sum + row.bytes, 0) / samples,
      serverCpuMs: (after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system) / 1000,
      serverPeakRssBytes: after.peakRssBytes,
      responseDigest: createHash('sha256').update(measurements.map(row => row.digest).join('\n')).digest('hex'),
      latencyMs: measurements.map(row => row.latencyMs) };
    results.push(result);
    console.log(JSON.stringify({ scenario: result.scenario, concurrency, p50Ms: result.p50Ms, p95Ms: result.p95Ms, errors: result.errors }));
  }
  const { stdout: commit } = await execute('git',['rev-parse','HEAD'],{cwd:root});
  const { stdout: dirty } = await execute('git',['status','--porcelain'],{cwd:root});
  const report = { label, recordedAt: new Date().toISOString(), commit: commit.trim(), dirtyWorkingTree: !!dirty.trim(),
    environment: { node: process.version, platform: process.platform, architecture: process.arch, osRelease: os.release(),
      cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, hostMemoryBytes: os.totalmem(),
      cap: JSON.parse(await readFile(resolve(root, 'node_modules/@sap/cds/package.json'), 'utf8')).version },
    dataset: { ...dataset, databaseBytes }, method: { runtime:'compiled CAP with SQLite and local reader identity', warmupPerScenario:20, concurrency:[1,8],
      latency:'request start through complete response body; no UI/CDN time', peakRss:'server RSS sampled every 50ms and at phase end',
      queryPlan:'representative offer lookup SQL; API timings use the actual existing application handler' }, results };
  const target = resolve(root, '.local/performance', `${label}-${Date.now()}.json`);
  await writeFile(target, JSON.stringify(report,null,2)+'\n');
  console.log('Performance report: ' + target);
} finally {
  process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child,'exit'); child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timeout); }
  }
  await Promise.all([database,database+'-wal',database+'-shm',database+'.json'].map(file => rm(file,{force:true})));
}
