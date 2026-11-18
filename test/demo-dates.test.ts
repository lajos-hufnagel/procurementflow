import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { shiftDemoDates, shiftDay as addDays } from '../srv/lib/demo-dates.ts';
import { fingerprint, type Offer } from '../srv/lib/rules.ts';
import { payloadHash } from '../srv/integration/contract.ts';
import { OrderWorker } from '../srv/integration/worker.ts';
import { HttpOrderTransport } from '../srv/integration/transport.ts';
import { erpDatabase, startErp, removeErpDatabase, erpProject, erpAuth } from './helpers/erp.ts';

const api = cds.test('serve', '--in-memory') as ReturnType<typeof cds.test> & { url: string };
const calendarFile = resolve('deployment/btp/demo-dates-2026-11-19.json');
const calendar = JSON.parse(await readFile(calendarFile, 'utf8'));
const shiftDay = (date: string) => addDays(date, 1);
const { SELECT, UPDATE } = cds.ql;
const CASE = '50000000-0000-4000-8000-000000000001';
const SECOND = '50000000-0000-4000-8000-000000000002';
const OFFER = '40000000-0000-4000-8000-000000000002';
type Row = Record<string, any>;
const rows = async (entity: string) => await cds.db.run(SELECT.from(entity)) as Row[];
const one = async (entity: string, ID: string) => await cds.db.run(SELECT.one.from(entity).where({ ID })) as Row;
let database: string | undefined;
let erp: Awaited<ReturnType<typeof startErp>> | undefined;
async function request(path: string, method = 'GET', body?: Row, user = 'buyer', locale = 'de') {
  const response = await fetch(api.url + '/procurement/' + path, { method, headers: {
    'Content-Type': 'application/json', 'Accept-Language': locale, 'If-Match': '*',
    Authorization: 'Basic ' + Buffer.from(user + ':demo-' + user).toString('base64')
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
const action = (ID: string, name: string, version: number, user = 'buyer', data: Row = {}) =>
  request('Cases(' + ID + ')/ProcurementService.' + name, 'POST', { expectedVersion: version, ...data }, user);
async function submit(ID = CASE, offerID = OFFER) {
  assert.equal((await action(ID, 'prepare', 0, 'buyer', { offerID, reason: 'Supply the production order', extraCostReason: 'Avoid a material shortage' })).status, 200);
  assert.equal((await action(ID, 'submit', 1)).status, 200);
}
async function migrateErp(apply = false) {
  const script = `import cds from '@sap/cds';
    import { readFile } from 'node:fs/promises';
    import { shiftDemoDates } from './srv/lib/demo-dates.ts';
    cds.model = cds.linked(await cds.load('*'));
    const db = await cds.connect.to('db');
    try { console.log('MIGRATION_RESULT ' + JSON.stringify(await shiftDemoDates(db, JSON.parse(await readFile(${JSON.stringify(calendarFile)}, 'utf8')), ${apply}))); }
    finally { await db.disconnect(); }`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
    cwd: erpProject, env: { ...process.env, cds_requires_db_credentials_url: database! }
  });
  return JSON.parse(result.stdout.split('MIGRATION_RESULT ')[1]!);
}
async function orders(): Promise<Row[]> {
  const response = await fetch(erp!.url + '/erp/Orders', { headers: erpAuth() });
  assert.equal(response.status, 200); return response.json();
}
beforeEach(async () => {
  await api.data.reset();
  process.env.PROCUREMENT_EVALUATION_DATE = calendar.from;
  for (const demand of calendar.demands) await cds.db.run(UPDATE.entity('procurement.Demands').set({ requiredOn: demand.requiredOn }).where({ ID: demand.ID }));
  for (const offer of calendar.offers) await cds.db.run(UPDATE.entity('procurement.Offers').set({ deliveryDate: offer.deliveryDate, validUntil: offer.validUntil }).where({ ID: offer.ID }));
  for (const row of await rows('procurement.Cases')) {
    const offer = calendar.offers.find((offer: Row) => offer.ID === row.referenceOffer_ID);
    await cds.db.run(UPDATE.entity('procurement.Cases').set({ referenceDeliveryDate: offer.deliveryDate }).where({ ID: row.ID }));
  }
});
afterEach(async () => {
  if (erp) await erp.stop();
  if (database) await removeErpDatabase(database);
  erp = undefined; database = undefined;
  delete process.env.PROCUREMENT_EVALUATION_DATE;
});

describe('Explicit synthetic calendar correction', () => {
  it('keeps the earlier calendar correction and its audit trail when moving the date again', async () => {
    const previous = JSON.parse(await readFile('deployment/btp/demo-dates-2026-11-18.json', 'utf8'));
    for (const row of previous.demands) await cds.db.run(UPDATE.entity('procurement.Demands').set({ requiredOn: row.requiredOn }).where({ ID: row.ID }));
    for (const row of previous.offers) await cds.db.run(UPDATE.entity('procurement.Offers').set({ deliveryDate: row.deliveryDate, validUntil: row.validUntil }).where({ ID: row.ID }));
    for (const row of await rows('procurement.Cases')) {
      const reference = previous.offers.find((offer: Row) => offer.ID === row.referenceOffer_ID);
      await cds.db.run(UPDATE.entity('procurement.Cases').set({ referenceDeliveryDate: reference.deliveryDate }).where({ ID: row.ID }));
    }
    await shiftDemoDates(cds.db, previous, true);
    const earlier = await rows('procurement.History');
    assert.equal(earlier.length, 12);
    await shiftDemoDates(cds.db, calendar, true);
    for (const row of earlier) assert.deepEqual(await one('procurement.History', row.ID), row);
    assert.equal((await rows('procurement.History')).length, 24);
    assert.equal((await one('procurement.Cases', CASE)).version, 2);
    assert.equal((await one('procurement.Demands', calendar.demands[0].ID)).requiredOn, shiftDay(calendar.demands[0].requiredOn));
    assert.equal((await shiftDemoDates(cds.db, calendar, true)).alreadyShifted, true);
    assert.equal((await rows('procurement.History')).length, 24);
  });

  it('starts fresh and reset demos on the shifted calendar, including December dates', async () => {
    await api.data.reset();
    delete process.env.PROCUREMENT_EVALUATION_DATE;
    assert.equal((await request('session()')).body.evaluationDate, calendar.to);
    for (const row of calendar.demands) assert.equal((await one('procurement.Demands', row.ID)).requiredOn, shiftDay(row.requiredOn));
    for (const row of calendar.offers) {
      const offer = await one('procurement.Offers', row.ID);
      assert.equal(offer.deliveryDate, shiftDay(row.deliveryDate));
      assert.equal(offer.validUntil, shiftDay(row.validUntil));
    }
    for (const row of await rows('procurement.Cases')) {
      const offer = await one('procurement.Offers', row.referenceOffer_ID);
      assert.equal(row.referenceDeliveryDate, offer.deliveryDate);
    }
    assert.equal((await shiftDemoDates(cds.db, calendar, true)).alreadyShifted, true);
    assert.equal((await rows('procurement.History')).length, 0);
  });

  it('preserves submitted decisions and real ERP orders, then accepts a retry without duplicating the order', async () => {
    database = erpDatabase(); erp = await startErp(database);
    const transport = new HttpOrderTransport(erp.url, 'integration', 'demo-integration');
    await submit();
    assert.equal((await action(CASE, 'approve', 2, 'approver')).status, 200);
    assert.equal(await new OrderWorker(transport).runDue(), 1);
    const second = await one('procurement.Cases', SECOND);
    await submit(SECOND, second.referenceOffer_ID);
    const beforeCases = await rows('procurement.Cases');
    const beforeHistory = await rows('procurement.History');
    const beforeSubmissions = await rows('procurement.Submissions');
    const beforeTransfer = (await rows('procurement.Transfers'))[0]!;
    const beforeOrder = (await orders())[0]!;
    const preview = await shiftDemoDates(cds.db, calendar);
    assert.equal(preview.applied, false);
    assert.equal((await one('procurement.Cases', CASE)).version, 4);
    assert.equal((await migrateErp()).counts['erp.Orders'], 1);
    assert.equal((await orders())[0]!.deliveryDate, beforeOrder.deliveryDate);
    const applied = await shiftDemoDates(cds.db, calendar, true);
    await migrateErp(true);
    process.env.PROCUREMENT_EVALUATION_DATE = calendar.to;
    assert.equal(applied.historyIDs.length, 12);
    for (const row of beforeCases) {
      const after = await one('procurement.Cases', row.ID);
      for (const field of ['ID', 'status', 'orderNumber', 'orderedAt', 'reason', 'totalCost', 'extraCost', 'delayDays', 'createdAt']) assert.equal(after[field], row[field], field);
      assert.equal(after.version, row.version + 1);
      assert.equal(after.referenceDeliveryDate, shiftDay(row.referenceDeliveryDate));
    }
    for (const row of beforeHistory) assert.deepEqual(await one('procurement.History', row.ID), row);
    for (const row of beforeSubmissions) {
      const after = await one('procurement.Submissions', row.ID);
      assert.equal(after.submittedAt, row.submittedAt); assert.equal(after.submittedBy, row.submittedBy);
      assert.equal(after.evaluatedOn, calendar.to);
      assert.equal(after.offerFingerprint, fingerprint({ ...after, ID: after.offer_ID, version: after.offerVersion } as Offer));
    }
    const transfer = (await rows('procurement.Transfers'))[0]!;
    for (const field of ['ID', 'status', 'createdAt', 'modifiedAt', 'confirmedAt', 'lastAttemptAt', 'orderNumber']) assert.equal(transfer[field], beforeTransfer[field], field);
    assert.equal(transfer.payloadHash, payloadHash(JSON.parse(transfer.payload)));
    const order = (await orders())[0]!;
    assert.equal(order.orderNumber, beforeOrder.orderNumber); assert.equal(order.createdAt, beforeOrder.createdAt);
    assert.equal(order.payloadHash, transfer.payloadHash);
    assert.equal(order.deliveryDate, shiftDay(beforeOrder.deliveryDate));
    assert.equal((await transport.send(JSON.parse(transfer.payload))).orderNumber, order.orderNumber);
    assert.equal((await orders()).length, 1);
    assert.equal((await shiftDemoDates(cds.db, calendar, true)).alreadyShifted, true);
    assert.equal((await migrateErp(true)).alreadyShifted, 1);
    assert.equal((await action(SECOND, 'approve', 2, 'approver')).status, 409);
    assert.equal((await action(SECOND, 'approve', 3, 'approver')).status, 200);
    const de = await request("History?$filter=event eq 'DemoDatesShifted'&$expand=eventInfo", 'GET', undefined, 'reader', 'de');
    const en = await request("History?$filter=event eq 'DemoDatesShifted'&$expand=eventInfo", 'GET', undefined, 'reader', 'en');
    assert.equal(de.body.value[0].eventInfo.name, 'Demo-Termine verschoben');
    assert.equal(en.body.value[0].eventInfo.name, 'Demo dates shifted');
  });

  it('keeps an already changed offer blocked after the date correction', async () => {
    await submit();
    await cds.db.run(UPDATE.entity('procurement.Offers').set({ unitPrice: '126.00' }).where({ ID: OFFER }));
    const result = await shiftDemoDates(cds.db, calendar, true);
    assert.equal(result.staleSelectionsPreserved, 1);
    process.env.PROCUREMENT_EVALUATION_DATE = calendar.to;
    const response = await action(CASE, 'approve', 3, 'approver');
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'OFFER_CHANGED');
  });

  it('keeps a saved draft usable and does not revive a stale workspace', async () => {
    const active = 'DecisionWorkspaces(ID=' + CASE + ',IsActiveEntity=true)';
    const draft = 'DecisionWorkspaces(ID=' + CASE + ',IsActiveEntity=false)';
    assert.equal((await request(active + '/ProcurementService.draftEdit', 'POST', { PreserveChanges: true })).status, 201);
    assert.equal((await request(draft, 'PATCH', { selectedOffer_ID: OFFER, reason: 'Saved draft', extraCostReason: 'Prevent a shortage' })).status, 200);
    await cds.db.run(UPDATE.entity('procurement.Cases').set({ version: 2 }).where({ ID: SECOND }));
    await shiftDemoDates(cds.db, calendar, true);
    process.env.PROCUREMENT_EVALUATION_DATE = calendar.to;
    assert.equal((await request(draft)).body.baseCaseVersion, 1);
    assert.equal((await one('procurement.DecisionWorkspaces', SECOND)).baseCaseVersion, 0);
    assert.equal((await request(draft + '/ProcurementService.draftActivate', 'POST', {})).status, 200);
    assert.equal((await one('procurement.Cases', CASE)).reason, 'Saved draft');
  });

  it('rejects mixed catalogs and rolls back even when writing the final audit records fails', async () => {
    const demand = calendar.demands[0];
    await cds.db.run(UPDATE.entity('procurement.Demands').set({ requiredOn: shiftDay(demand.requiredOn) }).where({ ID: demand.ID }));
    await assert.rejects(shiftDemoDates(cds.db, calendar, true), /Mixed calendar state/);
    assert.equal((await one('procurement.Cases', CASE)).version, 0);
    await cds.db.run(UPDATE.entity('procurement.Demands').set({ requiredOn: demand.requiredOn }).where({ ID: demand.ID }));
    await cds.db.run("CREATE TRIGGER fail_date_audit BEFORE INSERT ON procurement_History BEGIN SELECT RAISE(ABORT, 'simulated date audit failure'); END");
    try { await assert.rejects(shiftDemoDates(cds.db, calendar, true), /simulated date audit failure/); }
    finally { await cds.db.run('DROP TRIGGER fail_date_audit'); }
    assert.equal((await one('procurement.Cases', CASE)).version, 0);
    assert.equal((await one('procurement.Demands', demand.ID)).requiredOn, demand.requiredOn);
    assert.equal((await rows('procurement.History')).length, 0);
  });

  it('does not migrate while a transfer is processing or when its saved payload is corrupt', async () => {
    await submit(); await action(CASE, 'approve', 2, 'approver');
    await cds.db.run(UPDATE.entity('procurement.Transfers').set({ status: 'Processing' }));
    await assert.rejects(shiftDemoDates(cds.db, calendar, true), /transfer is running/);
    await cds.db.run(UPDATE.entity('procurement.Transfers').set({ status: 'Pending', payloadHash: 'invalid' }));
    await assert.rejects(shiftDemoDates(cds.db, calendar, true), /Corrupt transfer payload/);
    assert.equal((await one('procurement.Cases', CASE)).version, 3);
    assert.equal((await one('procurement.Demands', calendar.demands[0].ID)).requiredOn, calendar.demands[0].requiredOn);
  });
});
