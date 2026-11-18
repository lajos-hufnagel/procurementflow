import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const api = cds.test('serve', '--in-memory') as ReturnType<typeof cds.test> & { url: string };
const CASE = '50000000-0000-4000-8000-000000000001';
const A = '40000000-0000-4000-8000-000000000002';
const B = '40000000-0000-4000-8000-000000000003';
const path = `Cases(${CASE})/ProcurementService.`;
const { SELECT, UPDATE, DELETE } = cds.ql;
type Body = Record<string, any>;
async function call(resource: string, body?: Body, user: string | null = 'reader') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64');
  const response = await fetch(api.url + '/procurement/' + resource, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let data: Body;
  try { data = JSON.parse(raw); } catch { data = { text: raw }; }
  return { status: response.status, body: data };
}
const comparison = () => call(path + 'compareOffers()');
const prepare = (data: Body) => call(path + 'prepare', { expectedVersion: 0, offerID: A,
  reason: 'Fertigung rechtzeitig versorgen', extraCostReason: 'Lieferengpass vermeiden', ...data }, 'buyer');
beforeEach(async () => { process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-19'; await api.data.reset(); });

describe('M3: read-only comparison and cockpit over the shared data', () => {
  it('compares all matching offers with exact server amounts without preparing anything', async () => {
    const response = await comparison();
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.caseVersion, 0);
    assert.equal(response.body.referenceTotal, '2000.00');
    assert.equal(response.body.offers.length, 3);
    const a = response.body.offers.find((o: Body) => o.ID === A);
    assert.deepEqual([a.totalCost, a.extraCost, a.delayDays, a.needsExtraReason, a.available], ['2600.00', '600.00', 0, true, true]);
    assert.match(a.fingerprint, /^[a-f0-9]{64}$/);
    const b = response.body.offers.find((o: Body) => o.ID === B);
    assert.deepEqual([b.totalCost, b.extraCost, b.delayDays, b.needsExtraReason], ['2250.00', '250.00', 4, false]);
    assert.equal((await call(`Cases(${CASE})`)).body.version, 0);
    assert.equal((await cds.db.run(SELECT.from('procurement.History')) as Body[]).length, 0);
  });
  it('keeps expired offers visible but unavailable and uses the controlled evaluation date', async () => {
    process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-22';
    const response = await comparison();
    const a = response.body.offers.find((o: Body) => o.ID === A);
    const b = response.body.offers.find((o: Body) => o.ID === B);
    assert.equal(response.body.evaluationDate, '2026-11-22');
    assert.deepEqual([a.available, a.unavailableCode, a.totalCost, a.fingerprint], [false, 'OFFER_EXPIRED', null, null]);
    assert.equal(b.available, true);
    assert.equal((await prepare({})).body.error.code, 'OFFER_EXPIRED');
  });
  it('excludes mismatching quantities and currencies rather than comparing partial orders', async () => {
    await cds.db.run(UPDATE.entity('procurement.Offers').set({ currency: 'USD' }).where({ ID: A }));
    await cds.db.run(UPDATE.entity('procurement.Offers').set({ quantity: 19 }).where({ ID: B }));
    const response = await comparison();
    assert.equal(response.body.offers.length, 1);
    assert.equal(response.body.offers[0].isReference, true);
  });
  it('rejects changed conditions since comparison and rolls back the case claim', async () => {
    const a = (await comparison()).body.offers.find((o: Body) => o.ID === A);
    await cds.db.run(UPDATE.entity('procurement.Offers').set({ unitPrice: '126.00' }).where({ ID: A }));
    const changed = await prepare({ expectedOfferFingerprint: a.fingerprint });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'OFFER_CHANGED');
    assert.equal((await call(`Cases(${CASE})`)).body.version, 0);
    assert.equal((await cds.db.run(SELECT.from('procurement.History')) as Body[]).length, 0);
    const current = (await comparison()).body.offers.find((o: Body) => o.ID === A);
    const saved = await prepare({ expectedOfferFingerprint: current.fingerprint });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.totalCost, '2620.00');
    const workspace = (await call(`DecisionWorkspaces(ID=${CASE},IsActiveEntity=true)`)).body;
    assert.equal(workspace.selectedOffer_ID, A);
    assert.equal(workspace.baseCaseVersion, 1);
  });
  it('counts all 12 seeded cases and updates after the actual approval workflow', async () => {
    const summary = await call('cockpitSummary()');
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.deepEqual([summary.body.total, summary.body.open, summary.body.urgent, summary.body.submitted, summary.body.approved], [12, 12, 4, 0, 0]);
    assert.equal(summary.body.urgentUntil, '2026-11-22');
    assert.equal((await call('Materials')).body.value.length, 8);
    assert.equal((await call('Suppliers')).body.value.length, 5);
    assert.equal((await prepare({})).status, 200);
    assert.equal((await call(path + 'submit', { expectedVersion: 1 }, 'buyer')).status, 200);
    assert.equal((await call('cockpitSummary()')).body.submitted, 1);
    assert.equal((await call(path + 'approve', { expectedVersion: 2 }, 'approver')).status, 200);
    const after = (await call('cockpitSummary()')).body;
    assert.deepEqual([after.open, after.submitted, after.approved], [11, 0, 1]);
  });
  it('uses the cutoff inclusively and excludes completed cases from urgent counts', async () => {
    await cds.db.run(UPDATE.entity('procurement.Cases').set({ status: 'Approved' }).where({ ID: '50000000-0000-4000-8000-000000000004' }));
    assert.equal((await call('cockpitSummary()')).body.urgent, 3);
    process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-20';
    assert.equal((await call('cockpitSummary()')).body.urgent, 5);
  });
  it('reports numeric zeros when no cases exist', async () => {
    await cds.db.run(DELETE.from('procurement.Cases'));
    const response = await call('cockpitSummary()');
    assert.equal(response.status, 200);
    const { total, open, urgent, submitted, approved } = response.body;
    assert.deepEqual({ total, open, urgent, submitted, approved }, { total: 0, open: 0, urgent: 0, submitted: 0, approved: 0 });
  });
  it('counts mixed statuses once and includes only actionable statuses at the urgency cutoff', async () => {
    const cases = await cds.db.run(SELECT.from('procurement.Cases').orderBy('ID')) as Body[];
    const statuses = ['Open', 'Submitted', 'Approved', 'Rejected', 'Ordered'];
    for (const [i, row] of cases.entries()) {
      await cds.db.run(UPDATE.entity('procurement.Cases').set({ status: statuses[i % statuses.length]! }).where({ ID: row.ID }));
    }
    await cds.db.run(UPDATE.entity('procurement.Demands').set({ requiredOn: '2026-11-22' }));
    const response = await call('cockpitSummary()');
    assert.equal(response.status, 200);
    const { total, open, urgent, submitted, approved } = response.body;
    assert.deepEqual({ total, open, urgent, submitted, approved }, { total: 12, open: 3, urgent: 8, submitted: 3, approved: 2 });
  });
  it('requires an authenticated role for both functions and never grants readers writes', async () => {
    for (const resource of ['cockpitSummary()', path + 'compareOffers()']) {
      assert.equal((await call(resource, undefined, null)).status, 401);
      assert.equal((await call(resource, undefined, 'unknown')).status, 401);
      for (const role of ['reader', 'buyer', 'approver', 'dual']) assert.equal((await call(resource, undefined, role)).status, 200);
    }
    assert.equal((await call(path + 'prepare', { expectedVersion: 0, offerID: A }, 'reader')).status, 403);
    assert.equal((await call('Cases(50000000-0000-4000-8000-999999999999)/ProcurementService.compareOffers()')).status, 404);
  });
});
