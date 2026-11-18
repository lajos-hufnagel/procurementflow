import { registerDemoOrderCleanup } from './lib/demo-cleanup.ts';
import cds, { type Request } from '@sap/cds';
import { validateOrder, fingerprint, ProtocolError, type OrderInput } from './lib/order-contract.ts';

const { SELECT, INSERT } = cds.ql;
const modes = ['available', 'unavailable', 'drop-after-commit-once'] as const;
type Mode = typeof modes[number];
interface StoredOrder extends OrderInput { payloadHash: string; orderNumber: string; createdAt: string; }

function sameOrder(existing: StoredOrder, hash: string): StoredOrder {
  if (existing.payloadHash !== hash) throw new ProtocolError('IDEMPOTENCY_CONFLICT', 'This operationID already belongs to different order data.', 409);
  return existing;
}

export default class ErpService extends cds.ApplicationService {
  private mode: Mode = 'available';

  override async init() {
    registerDemoOrderCleanup();
    const configured = process.env.ERP_DEMO_MODE ?? 'available';
    if (!modes.includes(configured as Mode) || (cds.env.profiles.includes('production') && configured !== 'available')) throw new Error('Invalid ERP simulation mode.');
    this.mode = configured as Mode;
    this.on('simulate', (req: Request) => {
      if (cds.env.profiles.includes('production')) return req.reject(403, 'DEMO_MODE_DISABLED');
      if (!modes.includes(req.data.mode as Mode)) return req.reject(400, 'INVALID_DEMO_MODE');
      this.mode = req.data.mode as Mode;
      return { mode: this.mode };
    });
    this.on('CREATE', 'Orders', async (req: Request) => {
      if (this.mode === 'unavailable') return req.reject(503, 'ERP_TEMPORARILY_UNAVAILABLE');
      const order = validateOrder(req.data);
      const hash = fingerprint(order);
      let result: StoredOrder;
      // An explicit root transaction finishes before responding. No other writes belong to the request.
      try {
        result = await cds.tx({ user: req.user }, async tx => {
          const existing = await tx.run(SELECT.one.from('erp.Orders').where({ operationID: order.operationID })) as StoredOrder | undefined;
          if (existing) return sameOrder(existing, hash);
          const created = { ...order, payloadHash: hash,
            orderNumber: 'SIM-' + order.operationID.replaceAll('-', '').toUpperCase(), createdAt: new Date().toISOString() };
          await tx.run(INSERT.into('erp.Orders').entries(created));
          return created;
        });
      } catch (error) {
        if (error instanceof ProtocolError) throw error;
        // If a concurrent insert won, read it after our failed transaction has rolled back.
        // Only a matching durable record may turn that error into an idempotent success.
        const winner = await cds.tx({ user: req.user }, tx => tx.run(SELECT.one.from('erp.Orders').where({ operationID: order.operationID }))) as StoredOrder | undefined;
        if (!winner) throw error;
        result = sameOrder(winner, hash);
      }
      if (this.mode === 'drop-after-commit-once') {
        this.mode = 'available';
        // The database commit above has already completed; destroying the reply cannot roll it back.
        req.http?.res.destroy();
      }
      return result;
    });
    return super.init();
  }
}
