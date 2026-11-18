import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';

import { demoTables } from '../srv/lib/demo-seed.ts';

// Keep package pins/locks in sources; both HDI deployers use the same toolchain.
for (const target of ['gen/db', 'gen/erp-db']) {
  for (const file of ['package.json', 'package-lock.json']) await cp(`deployment/hdi/${file}`, `${target}/${file}`);
}
await rm('gen/approuter', { recursive: true, force: true });
await cp('deployment/approuter', 'gen/approuter', { recursive: true, filter: source => !source.split('/').includes('node_modules') });
await cp('gen/srv/app', 'gen/approuter/resources', { recursive: true });
console.log('AppRouter mit beiden UIs und reproduzierbare HDI-Deployer erzeugt.');

// HDI owns only read-only code lists. Business rows are inserted by a one-off operator task.
await mkdir('gen/srv/demo-data', { recursive: true });
await mkdir('gen/srv/scripts', { recursive: true });
await cp('deployment/btp/seed-demo.mjs', 'gen/srv/scripts/seed-demo.mjs');
for (const target of ['gen/srv', 'gen/erp']) {
  await mkdir(`${target}/scripts`, { recursive: true });
  await cp('scripts/shift-demo-dates.mjs', `${target}/scripts/shift-demo-dates.mjs`);
  for (const date of ['2026-11-18', '2026-11-19']) {
    await cp(`deployment/btp/demo-dates-${date}.json`, `${target}/scripts/demo-dates-${date}.json`);
  }
}

for (const table of demoTables) {
  const stem = `procurement.${table}`;
  await cp(`db/data/${stem}.csv`, `gen/srv/demo-data/${stem}.csv`);
  await rm(`gen/db/src/gen/data/${stem}.csv`, { force: true });
  await rm(`gen/db/src/gen/data/${stem}.hdbtabledata`, { force: true });
}
console.log('Veränderliche Demodaten vom HDI-Import getrennt; explizite Initialisierung als CF-Task bereit.');

// Compiled runtimes never load development plugins, even in the local SQLite profile.
for (const target of ['gen/srv', 'gen/erp']) {
  const file = `${target}/package.json`;
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  delete pkg.devDependencies;
  await writeFile(file, JSON.stringify(pkg, null, 2) + '\n');
  const lockFile = `${target}/package-lock.json`;
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  delete lock.packages[''].devDependencies;
  await writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
}
