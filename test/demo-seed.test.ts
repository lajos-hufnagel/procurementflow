import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { demoTables, initializeEmptyDemo } from '../srv/lib/demo-seed.ts';

const api = cds.test('serve', '--in-memory');
const { SELECT, DELETE, UPDATE } = cds.ql;
const CASE = '50000000-0000-4000-8000-000000000001';
const initialize = () => initializeEmptyDemo('db/data');
const count = async (table: string) => (await cds.db.run(SELECT.one.from(`procurement.${table}`).columns('count(*) as total'))).total;
beforeEach(async () => { await api.data.reset(); });
async function empty() {
  for (const table of [...demoTables].reverse()) await cds.db.run(DELETE.from(`procurement.${table}`));
}

describe('M5: one-off initialization without HDI ownership of mutable rows', () => {
  it('initializes all demo business rows with valid associations in one empty database', async () => {
    await empty();
    assert.deepEqual(await initialize(), { Materials: 8, Suppliers: 5, Demands: 12, Offers: 36, Cases: 12, DecisionWorkspaces: 12 });
    const row = await cds.db.run(SELECT.one.from('procurement.Cases').where({ ID: CASE }));
    assert.equal(row.status, 'Open'); assert.equal(row.version, 0); assert.equal(row.referenceTotal, '2000.00'); assert.equal(row.referenceQuantity, 20);
    const workspace = await cds.db.run(SELECT.one.from('procurement.DecisionWorkspaces').where({ ID: CASE }));
    assert.equal(workspace.procurementCase_ID, row.ID);
    assert.equal(await count('Transfers'), 0);
  });
  it('refuses populated or partly populated tables and preserves all existing changes', async () => {
    await cds.db.run(UPDATE.entity('procurement.Cases').set({ reason: 'Do not overwrite this decision', version: 7 }).where({ ID: CASE }));
    await assert.rejects(initialize(), /requires empty business tables/);
    const row = await cds.db.run(SELECT.one.from('procurement.Cases').where({ ID: CASE }));
    assert.equal(row.reason, 'Do not overwrite this decision'); assert.equal(row.version, 7);
    await cds.db.run(DELETE.from('procurement.DecisionWorkspaces'));
    await cds.db.run(DELETE.from('procurement.Cases'));
    await assert.rejects(initialize(), /requires empty business tables/);
    assert.equal(await count('Cases'), 0); assert.equal(await count('Offers'), 36);
  });
  it('rolls back all earlier inserts when a late insert fails', async () => {
    await empty();
    await cds.db.run("CREATE TRIGGER fail_seed BEFORE INSERT ON procurement_DecisionWorkspaces BEGIN SELECT RAISE(ABORT, 'simulated seed failure'); END");
    try {
      await assert.rejects(initialize(), /simulated seed failure/);
      for (const table of demoTables) assert.equal(await count(table), 0);
    } finally { await cds.db.run('DROP TRIGGER fail_seed'); }
    assert.equal((await initialize()).Cases, 12);
  });
  it('lets concurrent initializations produce only one complete data set', async () => {
    await empty();
    const results = await Promise.allSettled([initialize(), initialize()]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await count('Cases'), 12); assert.equal(await count('Offers'), 36);
  });
});
