import cds from '@sap/cds';
import { readFile } from 'node:fs/promises';

/** Narrow, transactional SQLite upgrade. Never reseeds or changes a stored business decision. */
export async function migratePublicDemoSchema(db, model) {
  const tables = await db.run("SELECT name FROM sqlite_master WHERE type = 'table'");
  const names = new Set(tables.map(row => row.name));
  const columns = async name => (await db.run(`PRAGMA table_info("${name}")`)).map(row => row.name);
  const caseColumns = names.has('procurement_Cases') ? await columns('procurement_Cases') : [];
  const orderColumns = names.has('erp_Orders') ? await columns('erp_Orders') : [];
  const upgradeCases = caseColumns.length && !caseColumns.includes('demoScope');
  const upgradeOrders = orderColumns.length && !orderColumns.includes('demoSessionID');
  const upgradeScenario = names.has('procurement_DemoSessions') && !(await columns('procurement_DemoSessions')).includes('erpOutage');
  if (!upgradeCases && !upgradeOrders && !upgradeScenario) return false;
  const ddl = cds.compile.to.sql(model, { dialect: 'sqlite' });
  await db.tx(async tx => {
    const views = await tx.run("SELECT name, sql FROM sqlite_master WHERE type = 'view'");
    const quote = name => '"' + name.replaceAll('"', '""') + '"';
    for (const view of views) await tx.run('DROP VIEW ' + quote(view.name));
    if (upgradeCases) {
      const create = ddl.find(sql => /^CREATE TABLE procurement_Cases\s*\(/.test(sql));
      const sessions = ddl.find(sql => /^CREATE TABLE procurement_DemoSessions\s*\(/.test(sql));
      if (!create || !sessions) throw new Error('Missing public-demo schema for local migration.');
      await tx.run(create.replace('CREATE TABLE procurement_Cases ', 'CREATE TABLE pf_upgrade_Cases '));
      const fields = caseColumns.map(quote).join(', ');
      await tx.run(`INSERT INTO pf_upgrade_Cases (${fields}) SELECT ${fields} FROM procurement_Cases`);
      await tx.run('DROP TABLE procurement_Cases');
      await tx.run('ALTER TABLE pf_upgrade_Cases RENAME TO procurement_Cases');
      if (!names.has('procurement_DemoSessions')) await tx.run(sessions);
    }
    if (upgradeScenario) await tx.run('ALTER TABLE procurement_DemoSessions ADD COLUMN erpOutage BOOLEAN NOT NULL DEFAULT 0');
    if (upgradeCases || upgradeScenario) {
      // Only add the new immutable error label; never reseed business data.
      for (const table of ['TransferErrors', 'TransferErrors_texts']) {
        const [fields, ...rows] = cds.parse.csv(await readFile(`db/data/procurement.${table}.csv`, 'utf8'));
        const entries = rows.map(row => Object.fromEntries(fields.map((field, i) => [field, row[i]])))
          .filter(row => row.code === 'ERP_DEMO_OUTAGE');
        for (const row of entries) {
          const entity = 'procurement.' + table;
          const key = { code: row.code, ...(row.locale ? { locale: row.locale } : {}) };
          if (await tx.run(cds.ql.SELECT.one.from(entity).where(key))) {
            await tx.run(cds.ql.UPDATE.entity(entity).set({ name: row.name }).where(key));
          } else await tx.run(cds.ql.INSERT.into(entity).entries(row));
        }
      }
    }
    if (upgradeOrders) {
      await tx.run('ALTER TABLE erp_Orders ADD COLUMN demoSessionID NVARCHAR(36)');
      await tx.run('ALTER TABLE erp_Orders ADD COLUMN demoExpiresAt TIMESTAMP_TEXT');
    }
    const updatedViews = new Map(ddl.filter(sql => /^CREATE VIEW /.test(sql)).map(sql => [sql.match(/^CREATE VIEW (\S+)/)[1], sql]));
    for (const view of views) if (!updatedViews.has(view.name)) updatedViews.set(view.name, view.sql);
    for (const sql of updatedViews.values()) await tx.run(sql);
  });
  console.log('Updated local demo schema; existing cases, drafts, history and orders were preserved.');
  return true;
}
