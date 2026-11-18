import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calendarDay, evaluate, fingerprint, type Demand, type Offer, type ProcurementCase } from '../srv/lib/rules.ts';

const demand: Demand = { ID: 'd', material_ID: 'm', quantity: 3, unit: 'EA', requiredOn: '2026-11-23' };
const offer: Offer = { ID: 'o', material_ID: 'm', supplier_ID: 's', quantity: 3, unit: 'EA', currency: 'EUR', unitPrice: '0.10', shipping: '0.20', deliveryDate: '2026-11-22', validUntil: '2026-11-21', version: 1 };
const procurementCase: ProcurementCase = { ID: 'c', demand_ID: 'd', status: 'Open', version: 0, referenceTotal: '0.40', referenceCurrency: 'EUR', referenceQuantity: 3, referenceUnit: 'EA', selectedOffer_ID: null, selectedOfferFingerprint: null, reason: null, extraCostReason: null, submissionSequence: 0, currentSubmission_ID: null };

describe('decimal arithmetic and calendar dates', () => {
  it('keeps cent amounts exact through multiplication, addition and subtraction', () => {
    const actual = evaluate(offer, demand, procurementCase, '2026-11-19');
    assert.equal(actual.totalCost, '0.50');
    assert.equal(actual.extraCost, '0.10');
    assert.equal(actual.delayDays, 0);
  });
  it('keeps a genuinely cheaper offer negative relative to the reference', () => {
    assert.equal(evaluate(offer, demand, { ...procurementCase, referenceTotal: '1.00' }, '2026-11-19').extraCost, '-0.50');
  });
  it('rejects sub-cent, nonfinite and negative prices', () => {
    for (const unitPrice of ['0.001', 'NaN', 'Infinity', '-0.01']) {
      assert.throws(() => evaluate({ ...offer, unitPrice }, demand, procurementCase, '2026-11-19'));
    }
  });
  it('rejects impossible calendar dates and handles leap years without local timezone arithmetic', () => {
    assert.throws(() => calendarDay('2026-02-29'));
    assert.throws(() => calendarDay('2026-13-01'));
    assert.equal(calendarDay('2028-03-01') - calendarDay('2028-02-28'), 2);
    assert.equal(calendarDay('2026-03-30') - calendarDay('2026-03-28'), 2);
  });
  it('compares equivalent price formats equally while detecting changed quote terms', () => {
    assert.equal(fingerprint(offer), fingerprint({ ...offer, unitPrice: 0.1, shipping: '0.2' }));
    assert.notEqual(fingerprint(offer), fingerprint({ ...offer, deliveryDate: '2026-11-21' }));
    assert.notEqual(fingerprint(offer), fingerprint({ ...offer, version: 2 }));
  });
});
