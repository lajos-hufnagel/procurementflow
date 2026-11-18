import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';

/** Versioned REST contract. Field order and monetary string normalization are part of the fingerprint. */
export interface OrderPayload {
  demoSessionID?: string; demoExpiresAt?: string;
  schemaVersion: 1; operationID: string; caseID: string; caseNumber: string; submissionID: string;
  revision: number; offerID: string; offerVersion: number; validUntil: string; materialID: string; supplierID: string; quantity: number; unit: string;
  currency: string; unitPrice: string; shipping: string; totalCost: string; deliveryDate: string;
}
export interface OrderConfirmation { operationID: string; payloadHash: string; orderNumber: string; }
export interface OrderSnapshot {
  demoScope?: string; demoExpiresAt?: string;
  ID: string; procurementCase_ID: string; caseNumber: string; revision: number;
  offer_ID: string; offerVersion: number; validUntil: string;
  material_ID: string; supplier_ID: string; quantity: number; unit: string; currency: string;
  unitPrice: string | number; shipping: string | number; totalCost: string | number; deliveryDate: string;
}
export function payloadFromSnapshot(snapshot: OrderSnapshot): OrderPayload {
  return {
    schemaVersion: 1, operationID: snapshot.ID, caseID: snapshot.procurementCase_ID,
    caseNumber: snapshot.caseNumber, submissionID: snapshot.ID, revision: snapshot.revision,
    offerID: snapshot.offer_ID, offerVersion: snapshot.offerVersion, validUntil: snapshot.validUntil,
    materialID: snapshot.material_ID, supplierID: snapshot.supplier_ID, quantity: snapshot.quantity,
    unit: snapshot.unit, currency: snapshot.currency, unitPrice: new Decimal(snapshot.unitPrice).toFixed(2),
    shipping: new Decimal(snapshot.shipping).toFixed(2), totalCost: new Decimal(snapshot.totalCost).toFixed(2),
    deliveryDate: snapshot.deliveryDate,
    ...(snapshot.demoScope && snapshot.demoScope !== 'shared' && snapshot.demoExpiresAt
      ? { demoSessionID: snapshot.demoScope, demoExpiresAt: new Date(snapshot.demoExpiresAt).toISOString() } : {})
  };
}
export function payloadHash(payload: OrderPayload): string {
  // OrderPayload is constructed in the explicit protocol order by payloadFromSnapshot, then stored unchanged.
  return createHash('sha256').update(JSON.stringify([
    payload.schemaVersion, payload.operationID, payload.caseID, payload.caseNumber, payload.submissionID,
    payload.revision, payload.offerID, payload.offerVersion, payload.validUntil, payload.materialID, payload.supplierID, payload.quantity, payload.unit,
    payload.currency, payload.unitPrice, payload.shipping, payload.totalCost, payload.deliveryDate,
    ...(payload.demoSessionID ? [payload.demoSessionID, payload.demoExpiresAt] : [])
  ])).digest('hex');
}
