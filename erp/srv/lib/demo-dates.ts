import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { Decimal } from 'decimal.js';
import { fingerprint, type OrderInput } from './order-contract.ts';

type Row = Record<string, any>;
interface Calendar { from: string; to: string; offers: { ID: string; deliveryDate: string; validUntil: string }[]; }
function calendarDay(value: string): number {
  const stamp = Date.parse(value + 'T00:00:00Z');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === value, 'Invalid calendar date');
  return stamp / 86400000;
}

/** Operator-only date correction for synthetic orders. Operation IDs, order numbers and creation times remain intact. */
export async function shiftDemoDates(db: any, calendar: Calendar, apply = false) {
  const days = calendarDay(calendar.to) - calendarDay(calendar.from);
  assert.ok(days > 0, 'The target evaluation date must follow the original date');
  const shift = (date: string) => new Date((calendarDay(date) + days) * 86400000).toISOString().slice(0, 10);
  return db.tx(async (tx: any) => {
    const rows = await tx.run(cds.ql.SELECT.from('erp.Orders')) as Row[];
    const originals = new Map(calendar.offers.map(row => [row.ID, row]));
    const changes: { operationID: string; before: Row; after: Row }[] = [];
    let alreadyShifted = 0;
    for (const row of rows) {
      const original = originals.get(row.offerID);
      assert.ok(original, 'Unknown ERP offer; nothing changed');
      const normalized = { ...row, unitPrice: new Decimal(row.unitPrice).toFixed(2),
        shipping: new Decimal(row.shipping).toFixed(2), totalCost: new Decimal(row.totalCost).toFixed(2),
        ...(row.demoSessionID ? { demoExpiresAt: new Date(row.demoExpiresAt).toISOString() } : {}) } as OrderInput;
      assert.equal(row.payloadHash, fingerprint(normalized), 'Corrupt ERP order fingerprint; nothing changed');
      if (row.deliveryDate === shift(original.deliveryDate) && row.validUntil === shift(original.validUntil)) {
        alreadyShifted++; continue;
      }
      assert.equal(row.deliveryDate, original.deliveryDate, 'Unexpected ERP delivery date; nothing changed');
      assert.equal(row.validUntil, original.validUntil, 'Unexpected ERP expiry; nothing changed');
      const deliveryDate = shift(row.deliveryDate), validUntil = shift(row.validUntil);
      changes.push({ operationID: row.operationID,
        before: { deliveryDate: row.deliveryDate, validUntil: row.validUntil, payloadHash: row.payloadHash },
        after: { deliveryDate, validUntil, payloadHash: fingerprint({ ...normalized, deliveryDate, validUntil }) } });
    }
    if (apply) for (const change of changes) {
      const changed = await tx.run(cds.ql.UPDATE.entity('erp.Orders').set(change.after).where({ operationID: change.operationID, ...change.before }));
      assert.equal(changed, 1, 'Concurrent order modification; all ERP calendar changes rolled back');
    }
    return { applied: apply && changes.length > 0, counts: { 'erp.Orders': changes.length }, alreadyShifted, backup: changes };
  });
}
