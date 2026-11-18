import cds from '@sap/cds';
import { DestinationOrderTransport } from './destination-transport.ts';
import { HttpOrderTransport } from './transport.ts';
import { OrderWorker } from './worker.ts';

function setting(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
  return value;
}

/** Timers wake the worker; the database is the source of pending work, including after restart. */
export function registerOrderWorker(): void {
  if (process.env.ERP_WORKER_ENABLED !== 'true') return;
  const production = cds.env.profiles.includes('production');
  const mode = process.env.ERP_TRANSPORT ?? (production ? 'destination' : 'direct');
  if (!['direct', 'destination'].includes(mode)) throw new Error('Invalid ERP_TRANSPORT.');
  const timeoutMs = setting('ERP_REQUEST_TIMEOUT_MS', mode === 'destination' ? 10000 : 2000, 50, 30000);
  let transport;
  if (mode === 'destination') {
    transport = new DestinationOrderTransport(process.env.ERP_DESTINATION ?? '', timeoutMs);
  } else {
    const url = process.env.ERP_BASE_URL;
    if (!url) throw new Error('ERP_BASE_URL is required for direct ERP transport.');
    transport = new HttpOrderTransport(url,
      process.env.ERP_USER ?? (production ? '' : 'integration'),
      process.env.ERP_PASSWORD ?? (production ? '' : 'demo-integration'), timeoutMs);
  }
  const worker = new OrderWorker(transport, {
    leaseMs: Math.max(10000, timeoutMs * 3),
    maxAttempts: setting('ERP_MAX_ATTEMPTS', 5, 1, 20),
    baseRetryMs: setting('ERP_RETRY_BASE_MS', 1000, 100, 60000),
    maxRetryMs: setting('ERP_RETRY_MAX_MS', 30000, 1000, 300000)
  });
  const intervalMs = setting('ERP_WORKER_INTERVAL_MS', 1500, 100, 60000);
  const abort = new AbortController();
  const log = cds.log('erp-transfer');
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;
  const wake = () => {
    if (stopped || running) return;
    running = worker.runDue(5, abort.signal).then(() => {}).catch((error: unknown) => {
      log.error('Transfer processing failed; durable claims remain available for recovery.',
        { code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN' });
    }).finally(() => { running = undefined; });
  };
  cds.once('listening', () => { wake(); timer = setInterval(wake, intervalMs); timer.unref(); });
  cds.once('shutdown', async () => { stopped = true; if (timer) clearInterval(timer); abort.abort(); await running; });
}
