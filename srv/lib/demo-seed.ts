import cds from '@sap/cds';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Runtime demo rows are never owned by HDI table-data imports.
export const demoTables = ['Materials', 'Suppliers', 'Demands', 'Offers', 'Cases', 'DecisionWorkspaces'] as const;
const businessTables = [...demoTables, 'Submissions', 'History', 'Transfers', 'TransferAttempts'];
const { SELECT, INSERT } = cds.ql;
// CAP 10 exposes this parser; the matching cds-types release omits its declaration.
const parseCSV = (cds.parse as typeof cds.parse & { csv(source: string): string[][] }).csv;

/** Explicit operator task only. No reset, upsert or automatic startup hook. */
export async function initializeEmptyDemo(directory: string): Promise<Record<string, number>> {
  const data = await Promise.all(demoTables.map(async table => {
    const csv = await readFile(join(directory, `procurement.${table}.csv`), 'utf8');
    const [columns, ...rows] = parseCSV(csv);
    if (!columns?.length || !rows.length || rows.some(row => row.length !== columns.length)) {
      throw new Error(`Invalid demo data for ${table}.`);
    }
    return { table, entries: rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index] === '' ? null : row[index]]))) };
  }));
  return await cds.tx({ user: new cds.User('demo-initialization') }, async tx => {
    for (const table of businessTables) {
      if (await tx.run(SELECT.one.from(`procurement.${table}`).columns('ID'))) {
        throw new Error('Demo initialization requires empty business tables. Existing data was not changed.');
      }
    }
    const counts: Record<string, number> = {};
    for (const { table, entries } of data) {
      await tx.run(INSERT.into(`procurement.${table}`).entries(entries));
      counts[table] = entries.length;
    }
    return counts;
  });
}
