import cds, { type Request } from '@sap/cds';
import { BusinessError, calendarDay, evaluate, evaluationDate, fingerprint,
  type Demand, type Offer, type ProcurementCase } from './rules.ts';

import { caseScope } from '../demo/scope.ts';

const { SELECT } = cds.ql;

/** Read-only comparison: the same decimal and validity rules used by prepare/submit/approve. */
export async function compareOffers(req: Request) {
  const id = (req.params[0] as { ID?: string } | undefined)?.ID;
  if (!id) throw new BusinessError('CASE_NOT_FOUND', 404);
  const tx = cds.tx(req);
  const item = await tx.run(SELECT.one.from('procurement.Cases').where({ ID: id, ...caseScope(req) })) as
    (ProcurementCase & { referenceOffer_ID: string }) | undefined;
  if (!item) throw new BusinessError('CASE_NOT_FOUND', 404);
  const demand = await tx.run(SELECT.one.from('procurement.Demands').where({ ID: item.demand_ID })) as Demand | undefined;
  if (!demand) throw new BusinessError('DEMAND_NOT_FOUND', 404);
  const offers = await tx.run(SELECT.from('procurement.Offers').columns('*', 'supplier.name as supplierName', 'supplier.city as city')
    .where({ material_ID: demand.material_ID, quantity: demand.quantity, unit: demand.unit, currency: item.referenceCurrency })
    .orderBy('deliveryDate', 'ID')) as (Offer & { supplierName: string; city: string })[];
  const today = evaluationDate();
  return {
    caseID: item.ID, caseVersion: item.version, evaluationDate: today, requiredOn: demand.requiredOn,
    referenceTotal: String(item.referenceTotal), currency: item.referenceCurrency,
    offers: offers.map(offer => {
      const result = {
        ID: offer.ID, supplierName: offer.supplierName, city: offer.city,
        quantity: offer.quantity, unit: offer.unit, currency: offer.currency,
        unitPrice: String(offer.unitPrice), shipping: String(offer.shipping),
        deliveryDate: offer.deliveryDate, validUntil: offer.validUntil,
        isReference: offer.ID === item.referenceOffer_ID, isSelected: offer.ID === item.selectedOffer_ID
      };
      try {
        return { ...result, ...evaluate(offer, demand, item, today), available: true,
          unavailableCode: null, fingerprint: fingerprint(offer) };
      } catch (error) {
        if (!(error instanceof BusinessError)) throw error;
        return { ...result, available: false, unavailableCode: error.code,
          totalCost: null, extraCost: null, delayDays: null, needsExtraReason: false, fingerprint: null };
      }
    })
  };
}

/** Counts cover the entire database, independently of list paging and browser filters. */
export async function cockpitSummary(req: Request) {
  const today = evaluationDate();
  const urgentUntil = new Date((calendarDay(today) + 3) * 86_400_000).toISOString().slice(0, 10);
  const tx = cds.tx(req);
  // Count non-null keys in one pass. Numeric CASE parameters are inferred as strings by HANA/hdb.
  // COUNT(ID) avoids that type ambiguity and still yields zero for empty sets.
  const summary = await tx.run(SELECT.one.from('procurement.Cases').columns`
    count(*) as total,
    count(case when status = 'Open' then ID end) as openCount,
    count(case when status = 'Submitted' then ID end) as submitted,
    count(case when status = 'Approved' then ID end) as approved,
    count(case when status in ('Open', 'Submitted', 'Rejected') and demand.requiredOn <= ${urgentUntil} then ID end) as urgent
  `.where(caseScope(req))) as { total: number; openCount: number; submitted: number; approved: number; urgent: number };
  return { evaluationDate: today, urgentUntil, total: Number(summary.total), open: Number(summary.openCount),
    urgent: Number(summary.urgent), submitted: Number(summary.submitted), approved: Number(summary.approved) };
}
