import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const cds = createRequire(resolve('package.json'))('@sap/cds');
cds.on('listening', ({ url }) => process.send?.({ url }));
await cds.exec('--port', '0');
