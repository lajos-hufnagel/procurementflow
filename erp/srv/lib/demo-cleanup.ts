import cds from '@sap/cds';

/** Only explicitly marked visitor orders expire. Ordinary integration orders remain durable. */
export async function cleanExpiredDemoOrders(now = Date.now()): Promise<number> {
  return await cds.db.run(cds.ql.DELETE.from('erp.Orders').where({
    demoSessionID: { '!=': null }, demoExpiresAt: { '<=': new Date(now - 15 * 60 * 1000).toISOString() }
  })) as number;
}
export function registerDemoOrderCleanup(): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<unknown> | undefined;
  const cleanup = () => {
    if (running) return;
    running = cleanExpiredDemoOrders().catch(() => cds.log('erp-demo').error('Expired demo order cleanup failed; will retry.'))
      .finally(() => { running = undefined; });
  };
  cds.once('listening', () => { cleanup(); timer = setInterval(cleanup, 60000); timer.unref(); });
  cds.once('shutdown', async () => { if (timer) clearInterval(timer); await running; });
}
