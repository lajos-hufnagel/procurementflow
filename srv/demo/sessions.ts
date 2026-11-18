import cds from '@sap/cds';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
export interface DemoSession { ID: string; tokenHash: string; createdAt: string; expiresAt: string; erpOutage: boolean; }
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const csrfToken = (token: string) => createHmac('sha256', token).update('procurementflow-demo-csrf').digest('hex');
const parseCSV = (cds.parse as typeof cds.parse & { csv(source: string): string[][] }).csv;
const lifetimeMs = 24 * 60 * 60 * 1000;

export async function findSession(token: string, now = Date.now()): Promise<DemoSession | undefined> {
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  return cds.db.run(SELECT.one.from('procurement.DemoSessions').where({ tokenHash: hashToken(token), expiresAt: { '>': new Date(now).toISOString() } }));
}

/** Session initialization never copies a visitor's edits or resets the existing shared data. */
export async function createSession(now = Date.now()): Promise<{ session: DemoSession; token: string }> {
  const directory = existsSync('demo-data') ? 'demo-data' : 'db/data';
  const [columns, ...rows] = parseCSV(await readFile(join(directory, 'procurement.Cases.csv'), 'utf8'));
  if (!columns?.length || rows.length !== 12) throw new Error('The public demo requires the twelve case templates.');
  const token = randomBytes(32).toString('hex');
  const session: DemoSession = { ID: cds.utils.uuid(), tokenHash: hashToken(token), erpOutage: false,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + lifetimeMs).toISOString() };
  await cds.tx({ user: new cds.User('demo-initialization') }, async tx => {
    const { total } = await tx.run(SELECT.one.from('procurement.DemoSessions').columns('count(*) as total')) as { total: number };
    if (Number(total) >= 500) throw Object.assign(new Error('DEMO_CAPACITY'), { status: 503 });
    await tx.run(INSERT.into('procurement.DemoSessions').entries(session));
    const entries = rows.map(row => ({ ...Object.fromEntries(columns.map((column, i) => [column, row[i] === '' ? null : row[i]])),
      ID: cds.utils.uuid(), demoScope: session.ID }));
    await tx.run(INSERT.into('procurement.Cases').entries(entries));
    await tx.run(INSERT.into('procurement.DecisionWorkspaces').entries(entries.map(row => ({
      ID: row.ID, procurementCase_ID: row.ID, baseCaseVersion: 0
    }))));
  });
  return { session, token };
}

export async function revokeSession(id: string): Promise<void> {
  await cds.db.run(UPDATE.entity('procurement.DemoSessions').set({ expiresAt: new Date().toISOString() }).where({ ID: id }));
}

/** Fifteen minutes of grace lets already running requests settle; live ERP claims postpone deletion. */
export async function cleanExpiredSessions(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - 15 * 60 * 1000).toISOString();
  const expired = await cds.db.run(SELECT.from('procurement.DemoSessions').where({ expiresAt: { '<=': cutoff } }).limit(100)) as DemoSession[];
  let removed = 0;
  for (const session of expired) {
    removed += await cds.tx({ user: new cds.User('demo-cleanup') }, async tx => {
      const cases = await tx.run(SELECT.from('procurement.Cases').columns('ID').where({ demoScope: session.ID })) as { ID: string }[];
      const ids = cases.map(row => row.ID);
      // Lock plain job rows before cases, in the same order as the ERP worker.
      const jobs = ids.length ? await tx.run(SELECT.from('procurement.Transfers').columns('ID', 'status', 'leaseUntil')
        .where({ procurementCase_ID: { in: ids } }).forUpdate()) as { ID: string; status: string; leaseUntil: string | null }[] : [];
      if (jobs.some(job => job.status === 'Processing' && job.leaseUntil && job.leaseUntil > new Date(now).toISOString())) return 0;
      if (ids.length) {
        await tx.run(SELECT.from('procurement.Cases').columns('ID').where({ ID: { in: ids } }).forUpdate());
        const drafts = 'ProcurementService.DecisionWorkspaces.drafts';
        const admin = await tx.run(SELECT.from(drafts).columns('DraftAdministrativeData_DraftUUID').where({ ID: { in: ids } })) as { DraftAdministrativeData_DraftUUID: string }[];
        await tx.run(DELETE.from(drafts).where({ ID: { in: ids } }));
        if (admin.length) await tx.run(DELETE.from('DRAFT.DraftAdministrativeData').where({ DraftUUID: { in: admin.map(row => row.DraftAdministrativeData_DraftUUID) } }));
        if (jobs.length) await tx.run(DELETE.from('procurement.TransferAttempts').where({ transfer_ID: { in: jobs.map(row => row.ID) } }));
        for (const table of ['Transfers', 'History', 'Submissions', 'DecisionWorkspaces']) {
          await tx.run(DELETE.from('procurement.' + table).where({ procurementCase_ID: { in: ids } }));
        }
        await tx.run(DELETE.from('procurement.Cases').where({ demoScope: session.ID }));
      }
      return await tx.run(DELETE.from('procurement.DemoSessions').where({ ID: session.ID, expiresAt: { '<=': cutoff } })) as number;
    });
  }
  return removed;
}
