import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('package.json'));
const cds = require('@sap/cds');
cds.on('listening', ({ url }) => process.send?.({ url }));
await cds.exec('--port', process.argv[2] ?? '0');
