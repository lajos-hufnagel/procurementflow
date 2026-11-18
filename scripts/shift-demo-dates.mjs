// Run with all writers stopped. Defaults to a read-only preview; never called on app startup.
import cds from '@sap/cds';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const apply = process.argv.includes('--apply');
const backup = process.argv.find(arg => arg.startsWith('--backup='))?.slice('--backup='.length);
assert.ok(!apply || backup, '--apply requires --backup=/absolute/path/report.json');
let compiled = true;
try { await access('srv/lib/demo-dates.js'); } catch { compiled = false; }
const calendarOverride = process.argv.find(arg => arg.startsWith('--calendar='))?.slice('--calendar='.length);
const calendarPath = calendarOverride ? resolve(calendarOverride) : compiled
  ? resolve(import.meta.dirname, 'demo-dates-2026-11-19.json')
  : resolve(import.meta.dirname, '../deployment/btp/demo-dates-2026-11-19.json');
const calendar = JSON.parse(await readFile(calendarPath, 'utf8'));
const { shiftDemoDates } = await import(pathToFileURL(resolve('srv/lib/demo-dates.' + (compiled ? 'js' : 'ts'))).href);
cds.model = cds.linked(await cds.load(compiled ? 'srv/csn.json' : '*'));
const db = await cds.connect.to('db');
try {
  const preview = await shiftDemoDates(db, calendar);
  if (backup) {
    await mkdir(dirname(resolve(backup)), { recursive: true });
    await writeFile(backup, JSON.stringify({ recordedAt: new Date().toISOString(), from: calendar.from, to: calendar.to, preview }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  const result = apply ? await shiftDemoDates(db, calendar, true) : preview;
  if (backup && apply) await writeFile(backup + '.result.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const { backup: changedFields, historyIDs, ...summary } = result;
  console.log(JSON.stringify({ ...summary, backupFile: backup, historyEntries: historyIDs?.length }, null, 2));
} finally { await db.disconnect(); }
