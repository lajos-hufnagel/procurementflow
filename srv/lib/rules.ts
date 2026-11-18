import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';

export type Status = 'Open' | 'Submitted' | 'Approved' | 'Rejected' | 'Ordered';
export type Action = 'prepare' | 'submit' | 'withdraw' | 'reopen' | 'approve' | 'decline';
export interface Demand {
  ID: string; material_ID: string; quantity: number; unit: string; requiredOn: string;
}
export interface Offer {
  ID: string; material_ID: string; supplier_ID: string; quantity: number; unit: string;
  currency: string; unitPrice: string | number; shipping: string | number;
  deliveryDate: string; validUntil: string; version: number;
}
export interface ProcurementCase {
  ID: string; demand_ID: string; status: Status; version: number;
  referenceTotal: string | number; referenceCurrency: string; referenceQuantity: number;
  referenceUnit: string; selectedOffer_ID: string | null;
  selectedOfferFingerprint: string | null; reason: string | null; extraCostReason: string | null;
  submissionSequence: number; currentSubmission_ID: string | null;
}
export interface Submission {
  ID: string; procurementCase_ID: string; offer_ID: string; offerFingerprint: string;
  submittedBy: string; revision: number;
}

export class BusinessError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const transitions: Record<Action, { from: Status; to: Status; role: string }> = {
  prepare: { from: 'Open', to: 'Open', role: 'Buyer' },
  submit: { from: 'Open', to: 'Submitted', role: 'Buyer' },
  withdraw: { from: 'Submitted', to: 'Open', role: 'Buyer' },
  reopen: { from: 'Rejected', to: 'Open', role: 'Buyer' },
  approve: { from: 'Submitted', to: 'Approved', role: 'Approver' },
  decline: { from: 'Submitted', to: 'Rejected', role: 'Approver' }
};
export function transition(action: Action, current: Status) {
  const rule = transitions[action];
  if (current !== rule.from) throw new BusinessError('INVALID_STATE', 409);
  return rule;
}

export function calendarDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BusinessError('INVALID_DATE');
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new BusinessError('INVALID_DATE');
  }
  return timestamp / 86_400_000;
}

export function evaluationDate(): string {
  const value = process.env.PROCUREMENT_EVALUATION_DATE ?? '2026-11-19';
  calendarDay(value);
  return value;
}

function price(value: string | number): Decimal {
  let amount: Decimal;
  try { amount = new Decimal(value); } catch { throw new BusinessError('INVALID_PRICE'); }
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 2) {
    throw new BusinessError('INVALID_PRICE');
  }
  return amount;
}

export function evaluate(offer: Offer, demand: Demand, procurementCase: ProcurementCase, today: string) {
  if (!Number.isSafeInteger(demand.quantity) || demand.quantity <= 0 ||
      offer.material_ID !== demand.material_ID || offer.quantity !== demand.quantity ||
      offer.unit !== demand.unit || offer.currency !== procurementCase.referenceCurrency ||
      demand.quantity !== procurementCase.referenceQuantity || demand.unit !== procurementCase.referenceUnit) {
    throw new BusinessError('OFFER_MISMATCH');
  }
  if (calendarDay(offer.validUntil) < calendarDay(today)) throw new BusinessError('OFFER_EXPIRED', 409);
  const unitPrice = price(offer.unitPrice);
  const shipping = price(offer.shipping);
  const reference = price(procurementCase.referenceTotal);
  const total = unitPrice.times(demand.quantity).plus(shipping);
  if (total.gte('10000000000000')) throw new BusinessError('AMOUNT_TOO_LARGE');
  const extra = total.minus(reference);
  return {
    totalCost: total.toFixed(2), extraCost: extra.toFixed(2),
    delayDays: Math.max(0, calendarDay(offer.deliveryDate) - calendarDay(demand.requiredOn)),
    needsExtraReason: extra.gte('500.00')
  };
}

export function fingerprint(offer: Offer): string {
  return createHash('sha256').update(JSON.stringify([
    offer.ID, offer.version, offer.material_ID, offer.supplier_ID, offer.quantity, offer.unit,
    offer.currency, price(offer.unitPrice).toFixed(2), price(offer.shipping).toFixed(2),
    offer.deliveryDate, offer.validUntil
  ])).digest('hex');
}

export function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > 2000) throw new BusinessError('INVALID_TEXT');
  return value.trim();
}

export function requireReasons(reason: unknown, extraReason: unknown, needsExtraReason: boolean) {
  if (!text(reason)) throw new BusinessError('REASON_REQUIRED');
  if (needsExtraReason && !text(extraReason)) throw new BusinessError('EXTRA_REASON_REQUIRED');
}
