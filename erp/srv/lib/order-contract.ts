import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';

/** The simulator validates its own API boundary independently of the sending application's implementation. */
export interface OrderInput {
  demoSessionID?: string; demoExpiresAt?: string;
  schemaVersion: 1; operationID: string; caseID: string; caseNumber: string; submissionID: string;
  revision: number; offerID: string; offerVersion: number; validUntil: string; materialID: string; supplierID: string; quantity: number; unit: string;
  currency: string; unitPrice: string; shipping: string; totalCost: string; deliveryDate: string;
}
export class ProtocolError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, message: string, statusCode = 400) {
    super(message); this.code = code; this.statusCode = statusCode;
  }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ProtocolError('INVALID_ORDER', `Invalid ${field}.`);
  return value.trim();
}
function id(value: unknown, field: string): string {
  const result = text(value, field, 36);
  if (!uuid.test(result)) throw new ProtocolError('INVALID_ORDER', `Invalid ${field}.`);
  return result.toLowerCase();
}
function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new ProtocolError('INVALID_ORDER', `Invalid ${field}.`);
  return value;
}
function amount(value: unknown, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new ProtocolError('INVALID_ORDER', `Invalid ${field}.`);
  let result: Decimal;
  try { result = new Decimal(value); } catch { throw new ProtocolError('INVALID_ORDER', `Invalid ${field}.`); }
  if (!result.isFinite() || result.isNegative() || result.decimalPlaces() > 2 || result.gte('10000000000000')) throw new ProtocolError('INVALID_ORDER', `Invalid ${field}.`);
  return result.toFixed(2);
}
function date(value: unknown, field: string): string {
  const result = text(value, field, 10);
  const stamp = Date.parse(result + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0,10) !== result) throw new ProtocolError('INVALID_ORDER', `Invalid ${field}.`);
  return result;
}
export function validateOrder(data: Record<string, unknown>): OrderInput {
  if (data.schemaVersion !== 1) throw new ProtocolError('UNSUPPORTED_ORDER_VERSION', 'schemaVersion must be 1.');
  const order: OrderInput = {
    schemaVersion: 1, operationID: id(data.operationID, 'operationID'), caseID: id(data.caseID, 'caseID'),
    caseNumber: text(data.caseNumber, 'caseNumber', 40), submissionID: id(data.submissionID, 'submissionID'),
    revision: integer(data.revision, 'revision'), offerID: id(data.offerID, 'offerID'),
    offerVersion: integer(data.offerVersion, 'offerVersion'), validUntil: date(data.validUntil, 'validUntil'), materialID: id(data.materialID, 'materialID'),
    supplierID: id(data.supplierID, 'supplierID'), quantity: integer(data.quantity, 'quantity'),
    unit: text(data.unit, 'unit', 10), currency: text(data.currency, 'currency', 3),
    unitPrice: amount(data.unitPrice, 'unitPrice'), shipping: amount(data.shipping, 'shipping'),
    totalCost: amount(data.totalCost, 'totalCost'), deliveryDate: date(data.deliveryDate, 'deliveryDate')
  };
  if (data.demoSessionID != null || data.demoExpiresAt != null) {
    order.demoSessionID = id(data.demoSessionID, 'demoSessionID');
    const expires = text(data.demoExpiresAt, 'demoExpiresAt', 24);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expires) || !Number.isFinite(Date.parse(expires)) ||
        new Date(expires).toISOString() !== expires) throw new ProtocolError('INVALID_ORDER', 'Invalid demoExpiresAt.');
    if (Date.parse(expires) <= Date.now()) throw new ProtocolError('DEMO_SESSION_EXPIRED', 'The demo session has expired.', 410);
    if (Date.parse(expires) > Date.now() + 25 * 60 * 60 * 1000) throw new ProtocolError('INVALID_ORDER', 'Invalid demo lifetime.');
    order.demoExpiresAt = expires;
  }
  if (!/^[A-Z]{3}$/.test(order.currency) || !/^[A-Z0-9]{1,10}$/.test(order.unit)) throw new ProtocolError('INVALID_ORDER', 'Invalid currency or unit.');
  if (!new Decimal(order.unitPrice).times(order.quantity).plus(order.shipping).equals(order.totalCost)) throw new ProtocolError('INVALID_ORDER_TOTAL', 'totalCost must equal quantity times unitPrice plus shipping.');
  return order;
}
export function fingerprint(order: OrderInput): string {
  return createHash('sha256').update(JSON.stringify([
    order.schemaVersion, order.operationID, order.caseID, order.caseNumber, order.submissionID,
    order.revision, order.offerID, order.offerVersion, order.validUntil, order.materialID, order.supplierID, order.quantity, order.unit,
    order.currency, order.unitPrice, order.shipping, order.totalCost, order.deliveryDate,
    ...(order.demoSessionID ? [order.demoSessionID, order.demoExpiresAt] : [])
  ])).digest('hex');
}
