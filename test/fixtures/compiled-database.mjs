// Test-only schema initialization from the compiled model and read-only HDI code lists.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const cds = createRequire(resolve('package.json'))('@sap/cds');
const file = resolve(cds.env.requires.db.credentials.url);
assert.equal(cds.env.requires.db.kind, 'sqlite');
assert.ok(!existsSync(file), 'Build test database must not exist before this fixture runs.');
cds.env.requires.db.data = [resolve('../db/src/gen/data')];
const db = await cds.connect.to('db');
try {
  await cds.deploy('srv/csn.json').to(db);
  const row = await db.run(cds.ql.SELECT.one.from('procurement.Cases').columns('count(*) as total'));
  assert.equal(row.total, 0, 'The compiled database must not automatically import business demo rows.');
} finally { await db.disconnect(); }
