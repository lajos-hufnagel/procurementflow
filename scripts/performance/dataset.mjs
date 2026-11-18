import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import cds from '@sap/cds';

export const dataVersion = 3;
export const id = (kind, n) => `9000000${kind}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const extraCases = Number(process.argv[2]);
const file = resolve(cds.env.requires.db.credentials.url);
assert.ok(Number.isSafeInteger(extraCases) && extraCases >= 100 && extraCases <= 100000);
assert.match(relative(resolve('.local'), file), /^performance-[a-f0-9-]+\.sqlite$/);
assert.equal(cds.env.requires.db.kind, 'sqlite');
assert.ok(!existsSync(file), 'Performance fixtures must never reuse or reset an existing database.');
const { SELECT, INSERT } = cds.ql;
const db = await cds.connect.to('db');
let urgent = 4;
try {
  await cds.deploy('*').to(db);
  const original = await db.run(SELECT.one.from('procurement.Cases').where({ ID: '50000000-0000-4000-8000-000000000001' }));
  const demand = await db.run(SELECT.one.from('procurement.Demands').where({ ID: original.demand_ID }));
  const offers = await db.run(SELECT.from('procurement.Offers').where({ material_ID: demand.material_ID }).orderBy('ID'));
  assert.equal(offers.length, 3);
  for (let offset = 0; offset < extraCases; offset += 500) {
    const data = { Materials: [], Demands: [], Offers: [], Cases: [], DecisionWorkspaces: [] };
    for (let n = offset + 1; n <= Math.min(offset + 500, extraCases); n++) {
      const material = id(1, n), demandID = id(3, n), caseID = id(5, n);
      const requiredOn = new Date(Date.UTC(2026, 10, 4 + n % 28)).toISOString().slice(0, 10);
      if (requiredOn <= '2026-11-22') urgent++;
      data.Materials.push({ ID: material, code: `PERF-${n}`, name: `Performance fixture material ${n}`, unit: 'EA' });
      data.Demands.push({ ...demand, ID: demandID, material_ID: material, requiredOn });
      for (const [j, offer] of offers.entries()) data.Offers.push({ ...offer, ID: id(4, (n - 1) * 3 + j + 1), material_ID: material });
      data.Cases.push({ ...original, ID: caseID, caseNumber: `PF-PERF-${String(n).padStart(6, '0')}`, demand_ID: demandID,
        referenceOffer_ID: id(4, (n - 1) * 3 + 1), title: `Read-only performance case ${n}`,
        createdAt: '2026-11-16T08:00:00.000Z', modifiedAt: '2026-11-16T08:00:00.000Z', createdBy: 'performance-fixture', modifiedBy: 'performance-fixture' });
      data.DecisionWorkspaces.push({ ID: caseID, procurementCase_ID: caseID, baseCaseVersion: 0 });
    }
    await db.run(async tx => {
      for (const [table, entries] of Object.entries(data)) await tx.run(INSERT.into(`procurement.${table}`).entries(entries));
    });
  }
  await db.run('ANALYZE');
  // CAP's generic SQL runner treats EXPLAIN as a write; use the SQLite statement reader explicitly.
  const plan = await db.run(async tx => {
    await tx.run('SELECT 1'); // Acquire the transaction connection before using the native statement reader.
    return tx.prepare(`EXPLAIN QUERY PLAN SELECT o.*, s.name, s.city FROM procurement_Offers o
    LEFT JOIN procurement_Suppliers s ON s.ID = o.supplier_ID
    WHERE o.material_ID = ? AND o.quantity = ? AND o.unit = ? AND o.currency = ? ORDER BY o.deliveryDate, o.ID`).all([id(1, 1), 20, 'EA', 'EUR']);
  });
  assert.ok(Array.isArray(plan) && plan.length > 0 && plan.every(row => typeof row.detail === 'string'));
  const counts = {};
  for (const table of ['Materials','Suppliers','Demands','Offers','Cases','DecisionWorkspaces']) {
    counts[table] = (await db.run(SELECT.one.from(`procurement.${table}`).columns('count(*) as total'))).total;
  }
  assert.equal(counts.Cases, extraCases + 12); assert.equal(counts.Offers, extraCases * 3 + 36);
  const sqlite = await db.run('SELECT sqlite_version() as version');
  await writeFile(file + '.json', JSON.stringify({ dataVersion, extraCases, counts, urgent,
    evaluationDate: '2026-11-19', sqlite: sqlite[0].version, representativeOfferLookupPlan: plan }, null, 2));
} finally { await db.disconnect(); }
console.log(JSON.stringify({ databaseBytes: (await stat(file)).size, extraCases, result: 'ready' }));
