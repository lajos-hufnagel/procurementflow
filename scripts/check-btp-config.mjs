import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const file = process.argv[2];
if (!file) throw new Error('Pass the local JSON-formatted .mtaext file, for example .local/trial.mtaext.');
const config = JSON.parse(await readFile(file, 'utf8'));
assert.equal(config['_schema-version'], '3.3.0');
assert.equal(config.extends, 'procurementflow');
assert.ok(typeof config.ID === 'string' && /^[a-z][a-z0-9-]+$/.test(config.ID));
const id = config.parameters?.['hana-database-id'];
assert.ok(typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id),
  'Replace hana-database-id with the real GUID of the existing, verified HANA instance.');
console.log('Local extension syntax is valid. This does not verify SAP access, the HANA instance, entitlements or cost.');
