import assert from 'node:assert/strict';
import { it } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const exec = promisify(execFile);
const CASE = '50000000-0000-4000-8000-000000000001';

it('upgrades an existing SQLite case database without resetting decisions, history or views', async () => {
  const file = resolve('.local', 'upgrade-' + randomUUID() + '.sqlite');
  const env = { ...process.env, NODE_ENV: 'development', cds_requires_db_credentials_url: file };
  try {
    await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    let db = new DatabaseSync(file);
    const views = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='view'").all() as { name: string; sql: string }[];
    let create = (db.prepare("SELECT sql FROM sqlite_master WHERE name='procurement_Cases'").get() as { sql: string }).sql;
    create = create.replace(/\n  demoScope[^\n]+,/, '').replace('UNIQUE (demoScope, caseNumber)', 'UNIQUE (caseNumber)')
      .replace('CREATE TABLE procurement_Cases ', 'CREATE TABLE pf_legacy_Cases ');
    const fields = (db.prepare('PRAGMA table_info(procurement_Cases)').all() as { name: string }[])
      .map(row => row.name).filter(name => name !== 'demoScope').map(name => '"' + name + '"').join(', ');
    db.exec('BEGIN');
    for (const view of views) db.exec('DROP VIEW "' + view.name + '"');
    db.exec(create);
    db.exec(`INSERT INTO pf_legacy_Cases (${fields}) SELECT ${fields} FROM procurement_Cases`);
    db.exec('DROP TABLE procurement_Cases; ALTER TABLE pf_legacy_Cases RENAME TO procurement_Cases; DROP TABLE procurement_DemoSessions');
    for (const view of views) db.exec(view.sql);
    db.prepare('UPDATE procurement_Cases SET reason=?, version=7 WHERE ID=?').run('Preserve my decision', CASE);
    db.prepare('INSERT INTO procurement_History (ID,procurementCase_ID,event,fromStatus,toStatus,caseVersion,actor,occurredAt,reason) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), CASE, 'Prepared', 'Open', 'Open', 7, 'buyer', new Date().toISOString(), 'Preserve my decision');
    db.exec('COMMIT'); db.close();
    const first = await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    assert.match(first.stdout, /Updated local demo schema/);
    const second = await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    assert.doesNotMatch(second.stdout, /Updated local demo schema/);
    db = new DatabaseSync(file);
    const item = db.prepare('SELECT reason,version,demoScope FROM procurement_Cases WHERE ID=?').get(CASE);
    assert.deepEqual({ ...item }, { reason: 'Preserve my decision', version: 7, demoScope: 'shared' });
    assert.equal((db.prepare('SELECT count(*) as n FROM procurement_History').get() as { n: number }).n, 1);
    assert.equal((db.prepare('SELECT count(*) as n FROM ProcurementService_Cases').get() as { n: number }).n, 12);
    assert.equal((db.prepare('SELECT count(*) as n FROM procurement_DemoSessions').get() as { n: number }).n, 0);
    db.close();
  } finally { await Promise.all([file, file+'-wal', file+'-shm'].map(path => rm(path, { force: true }))); }
});

it('adds the outage setting to existing visitor sessions without resetting their data or subsequent settings', async () => {
  const file = resolve('.local', 'scenario-upgrade-' + randomUUID() + '.sqlite');
  const env = { ...process.env, NODE_ENV: 'development', cds_requires_db_credentials_url: file };
  const sessionID = randomUUID(), tokenHash = '1'.repeat(64), expiry = '2027-01-01T00:00:00Z';
  try {
    await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    let db = new DatabaseSync(file);
    db.function('session_context', (_key) => 'de');
    db.exec('ALTER TABLE procurement_DemoSessions DROP COLUMN erpOutage');
    db.prepare('INSERT INTO procurement_DemoSessions (ID,tokenHash,createdAt,expiresAt) VALUES (?,?,?,?)').run(sessionID, tokenHash, '2026-11-18T00:00:00Z', expiry);
    db.prepare('UPDATE procurement_Cases SET reason=?, demoScope=? WHERE ID=?').run('Keep visitor decision', sessionID, CASE);
    db.exec("DELETE FROM procurement_TransferErrors WHERE code='ERP_DEMO_OUTAGE'; DELETE FROM procurement_TransferErrors_texts WHERE code='ERP_DEMO_OUTAGE'");
    db.close();
    await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    db = new DatabaseSync(file);
    assert.deepEqual({ ...db.prepare('SELECT tokenHash,expiresAt,erpOutage FROM procurement_DemoSessions WHERE ID=?').get(sessionID) }, { tokenHash, expiresAt: expiry, erpOutage: 0 });
    assert.equal(db.prepare('SELECT reason FROM procurement_Cases WHERE ID=?').get(CASE)?.reason, 'Keep visitor decision');
    assert.equal(db.prepare("SELECT name FROM procurement_TransferErrors WHERE code='ERP_DEMO_OUTAGE'").get()?.name, 'Demo-Simulation: ERP nicht erreichbar.');
    assert.equal(db.prepare("SELECT name FROM procurement_TransferErrors_texts WHERE code='ERP_DEMO_OUTAGE' AND locale='en'").get()?.name, 'Demo simulation: ERP unavailable.');
    db.prepare('UPDATE procurement_DemoSessions SET erpOutage=1 WHERE ID=?').run(sessionID); db.close();
    const again = await exec(process.execPath, ['scripts/database.mjs', 'init'], { env });
    assert.doesNotMatch(again.stdout, /Updated local demo schema/);
    db = new DatabaseSync(file);
    assert.equal(db.prepare('SELECT erpOutage FROM procurement_DemoSessions WHERE ID=?').get(sessionID)?.erpOutage, 1);
    db.close();
  } finally { await Promise.all([file, file+'-wal', file+'-shm'].map(path => rm(path, { force: true }))); }
});
