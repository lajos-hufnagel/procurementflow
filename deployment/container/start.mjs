import cds from '@sap/cds';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';

// This image is the local SQLite demo. BTP uses its separate production deployment.
if (cds.env.profiles.includes('production') || cds.env.requires.auth?.kind !== 'mocked') {
  throw new Error('The local container entrypoint requires the development demo profile.');
}
const config = cds.env.requires.db;
if (config?.kind !== 'sqlite') throw new Error('The local container requires SQLite.');
const file = resolve(config.credentials.url);
const inside = relative(resolve('.local'), file);
if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Container data must stay in the .local volume.');
if (!existsSync(file)) {
  mkdirSync(dirname(file), { recursive: true });
  const model = await cds.load('srv/csn.json');
  const db = await cds.connect.to('db');
  try { await cds.deploy(model).to(db); } finally { await db.disconnect(); }
  console.log('Missing local demo database initialized. Existing volumes are never reset on start.');
}
await cds.exec('--port', process.env.PORT ?? '4004');
