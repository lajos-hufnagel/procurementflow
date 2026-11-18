import assert from 'node:assert/strict';
import { readdir, access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { demoTables } from '../srv/lib/demo-seed.ts';

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') await inspect(path);
    else {
      assert.ok(!/\.(sqlite3?|db)(-|$)/.test(entry.name), `Runtime database leaked into build: ${path}`);
      assert.ok(!entry.name.endsWith('.ts'), `Uncompiled TypeScript in build: ${path}`);
      assert.ok(!/^\.env(?:\.|$)/.test(entry.name) && !['default-env.json', '.cdsrc-private.json'].includes(entry.name), `Local configuration in build: ${path}`);
    }
  }
}
await inspect('gen');
assert.deepEqual(JSON.parse(await readFile('gen/srv/package.json', 'utf8')).scripts, { start: 'cds-serve' });
await access('gen/srv/srv/procurement-service.js');
await access('gen/erp/srv/erp-service.js');
await access('gen/erp/srv/lib/order-contract.js');
await access('gen/erp-db/src/gen/erp.Orders.hdbtable');
assert.deepEqual(JSON.parse(await readFile('gen/erp/package.json', 'utf8')).scripts, { start: 'cds-serve' });
await access('gen/srv/srv/lib/rules.js');
await access('gen/srv/srv/lib/search.js');
for (const name of ['auth', 'http', 'sessions', 'scope', 'approval']) await access(`gen/srv/srv/demo/${name}.js`);
await access('gen/erp/srv/lib/demo-cleanup.js');
await access('gen/db/src/gen/procurement.DemoSessions.hdbtable');
await access('gen/srv/app/decisions/webapp/Component-preload.js');
await access('gen/srv/app/decisions/webapp/ext/History.js');
await access('gen/srv/app/cockpit/webapp/Component-preload.js');
await access('gen/srv/app/cockpit/webapp/controller/Main.controller.js');
await access('gen/srv/app/shared/bootstrap.js');
await access('gen/srv/app/decisions/webapp/manifest.json');
await access('gen/srv/app/shared/kernvado-systems.png');
await access('gen/srv/server.js');
await access('gen/srv/srv/csn.json');
await access('gen/db/src/gen/procurement.Cases.hdbtable');
for (const dir of ['gen/srv', 'gen/erp']) {
  const pkg = JSON.parse(await readFile(`${dir}/package.json`, 'utf8'));
  assert.equal(pkg.cds.requires['[production]'].db.kind, 'hana');
  assert.equal(pkg.cds.requires['[production]'].auth.kind, 'xsuaa');
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(pkg.dependencies['@cap-js/hana'] && pkg.dependencies['@sap/xssec']);
}
for (const dir of ['gen/db', 'gen/erp-db', 'gen/approuter']) {
  const pkg = JSON.parse(await readFile(`${dir}/package.json`, 'utf8'));
  const lock = JSON.parse(await readFile(`${dir}/package-lock.json`, 'utf8'));
  assert.deepEqual(pkg.dependencies, lock.packages[''].dependencies, `Package/lock mismatch: ${dir}`);
}
await access('gen/approuter/resources/cockpit/webapp/Component-preload.js');
await access('gen/approuter/resources/decisions/webapp/Component-preload.js');
await access('gen/approuter/resources/decisions/webapp/ext/History.js');
await access('gen/approuter/resources/shared/bootstrap.js');
await access('gen/approuter/xs-app.json');
await access('gen/approuter/start.cjs');
const publicRouter = JSON.parse(await readFile('gen/approuter/xs-app.public-demo.json', 'utf8'));
assert.equal(publicRouter.welcomeFile, undefined, 'The public root uses index.html to preserve query and hash parameters');
await access('gen/approuter/resources/index.html');
await access('gen/approuter/resources/shared/entry.js');
assert.ok(publicRouter.routes.every(route => route.authenticationType === 'none'));
assert.equal(publicRouter.routes[0].csrfProtection, false); // The CAP demo middleware checks the session-bound token.
assert.ok(new RegExp(publicRouter.routes[0].source).test('/demo/reset'));
assert.ok(new RegExp(publicRouter.routes[0].source).test('/demo/scenario'));
await access('gen/approuter/resources/shared/DemoScenario.js');
assert.ok(!new RegExp(publicRouter.routes[0].source).test('/erp/Orders'));
const { stdout: generatedSecurity } = await promisify(execFile)(process.execPath,
  [resolve('node_modules/@sap/cds-dk/bin/cds.js'), 'compile', 'srv', '--to', 'xsuaa']);
const scopes = security => security.scopes.map(scope => scope.name).sort();
assert.deepEqual(scopes(JSON.parse(await readFile('xs-security.json', 'utf8'))), scopes(JSON.parse(generatedSecurity)), 'XSUAA scopes must match actual CAP roles');
for (const table of demoTables) {
  await access(`gen/srv/demo-data/procurement.${table}.csv`);
  await assert.rejects(access(`gen/db/src/gen/data/procurement.${table}.hdbtabledata`), { code: 'ENOENT' });
  await assert.rejects(access(`gen/db/src/gen/data/procurement.${table}.csv`), { code: 'ENOENT' });
}
await access('gen/srv/scripts/seed-demo.mjs');
for (const target of ['gen/srv', 'gen/erp']) {
  await access(`${target}/srv/lib/demo-dates.js`);
  await access(`${target}/scripts/shift-demo-dates.mjs`);
  for (const date of ['2026-11-18', '2026-11-19']) await access(`${target}/scripts/demo-dates-${date}.json`);
}
console.log('Build geprüft: kompilierte Handler, CDS-Modell und HANA-Artefakte; keine lokalen Datenbanken oder Zugangskonfigurationen.');
