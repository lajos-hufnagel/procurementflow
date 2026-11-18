import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('package.json'));
const cds = require('@sap/cds');
cds.on('listening', ({ server }) => process.send?.({ url: `http://localhost:${server.address().port}` }));
await cds.exec('--port', '0');
