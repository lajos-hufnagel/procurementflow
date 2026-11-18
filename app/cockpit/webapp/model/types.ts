export interface Session { userID: string; roles: string[]; evaluationDate: string; }
export interface Summary { evaluationDate: string; urgentUntil: string; total: number; open: number; urgent: number; submitted: number; approved: number; }
export interface ProcurementCase {
  ID: string; caseNumber: string; title: string; status: string; version: number;
  referenceTotal: string; referenceCurrency: string; referenceDeliveryDate: string;
  reason: string | null; extraCostReason: string | null; selectedOffer_ID: string | null;
  demand: { quantity: number; unit: string; requiredOn: string; location: string; material: { code: string; name: string } };
  statusInfo: { name: string };
  orderNumber: string | null; orderedAt: string | null;
  transfer: { status: string; statusInfo: { name: string }; attemptCount: number; nextAttemptAt: string | null; errorInfo: { name: string } | null } | null;
}
export interface ComparedOffer {
  ID: string; supplierName: string; city: string; quantity: number; unit: string; currency: string;
  unitPrice: string; shipping: string; deliveryDate: string; validUntil: string;
  totalCost: string | null; extraCost: string | null; delayDays: number | null;
  needsExtraReason: boolean; isReference: boolean; isSelected: boolean;
  available: boolean; unavailableCode: string | null; fingerprint: string | null;
}
export interface Comparison { caseID: string; caseVersion: number; evaluationDate: string; requiredOn: string; referenceTotal: string; currency: string; offers: ComparedOffer[]; }
