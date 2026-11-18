import { migratePublicDemoSchema } from './migrate-public-demo.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { createRequire } from 'node:module';
const cds = createRequire(resolve('package.json'))('@sap/cds');

const command = process.argv[2];
if (!['init', 'reset'].includes(command)) throw new Error('Use db:init or db:reset.');
if (cds.env.profiles.includes('production')) throw new Error('The local seed/reset command is disabled in production.');
const config = cds.env.requires.db;
if (config?.kind !== 'sqlite') throw new Error('Only a local SQLite demo database can be initialized.');
const filename = resolve(config.credentials.url);
const insideDb = relative(resolve('.local'), filename);
if (!insideDb || insideDb.startsWith('..') || isAbsolute(insideDb)) {
  throw new Error('The demo database must be a file inside this project’s .local directory.');
}
if (command === 'init' && existsSync(filename)) {
  const db = await cds.connect.to('db');
  try { await migratePublicDemoSchema(db, await cds.load('*')); } finally { await db.disconnect(); }
  console.log('Keeping existing database: ' + relative(process.cwd(), filename));
} else {
  mkdirSync(dirname(filename), { recursive: true });
  const db = await cds.connect.to('db');
  try {
    await cds.deploy('*').to(db);
    console.log('Demo data ready: ' + relative(process.cwd(), filename));
  } finally { await db.disconnect(); }
}
