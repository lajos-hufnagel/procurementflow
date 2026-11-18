import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const backend = new URL(process.argv[2]);
assert.equal(backend.hostname, 'localhost', 'Only the isolated local CAP test server is allowed');
process.env.destinations = JSON.stringify([{ name: 'srv-api', url: backend.origin, forwardAuthToken: false }]);
const require = createRequire(resolve('deployment/approuter/package.json'));
const router = require('@sap/approuter')();
const publicDemo = process.argv[3] === 'public-demo';
const config = JSON.parse(await readFile('gen/approuter/' + (publicDemo ? 'xs-app.public-demo.json' : 'xs-app.json'), 'utf8'));
assert.equal(config.authenticationMethod, 'route');
assert.ok(config.routes.every(route => route.authenticationType === (publicDemo ? 'none' : 'xsuaa')));
// Test-only login substitution. Use the actual packaged routes/resources, proxy and CSRF handling.
// This tests routing and search transport; it does not claim an XSUAA login or HANA connection.
const localConfig = publicDemo ? config : { ...config, authenticationMethod: 'none',
  routes: config.routes.map(route => ({ ...route, authenticationType: 'none' })) };
await new Promise((resolveStart, reject) => {
  router.start({ port: 0, workingDir: resolve('gen/approuter'), xsappConfig: localConfig }, error => {
    if (error) reject(error); else resolveStart();
  });
});
const port = router._server._server.address().port;
process.send?.({ url: `http://127.0.0.1:${port}` });
process.once('SIGTERM', () => router.close(() => process.exit(0)));
