import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { erpDatabase, startErp, removeErpDatabase, erpAuth } from './helpers/erp.ts';
import { HttpOrderTransport } from '../srv/integration/transport.ts';
process.env.CDS_ENV = 'public-demo';
const { default: cds } = await import('@sap/cds');
const { cleanExpiredSessions } = await import('../srv/demo/sessions.ts');
const { OrderWorker } = await import('../srv/integration/worker.ts');

const api = cds.test('serve', '--in-memory', '--profile', 'public-demo') as ReturnType<typeof cds.test> & { url: string };
const { SELECT, UPDATE, DELETE } = cds.ql;
const OFFER = '40000000-0000-4000-8000-000000000002';
type Body = Record<string, any>;
type Visitor = { cookie: string; csrf: string };
async function raw(path: string, visitor?: Visitor, method = 'GET', body?: Body, role = 'buyer', extra: Record<string, string> = {}) {
  const response = await fetch(api.url + path, { method, headers: {
    Origin: api.url, 'Content-Type': 'application/json', 'Accept-Language': 'en', 'If-Match': '*',
    ...(visitor ? { Cookie: visitor.cookie, 'X-Demo-CSRF': visitor.csrf, 'X-Demo-Role': role } : {}), ...extra
  }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data: Body; try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  return { status: response.status, body: data, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const read = (visitor: Visitor, path: string, role = 'buyer') => raw('/procurement/' + path, visitor, 'GET', undefined, role);
async function visit(): Promise<Visitor> {
  const result = await raw('/demo/session', undefined, 'POST', undefined, 'buyer', { 'X-Demo-Bootstrap': '1' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { cookie: result.cookie, csrf: result.body.csrfToken };
}
async function cases(visitor: Visitor) {
  const response = await read(visitor, 'Cases?$orderby=caseNumber');
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.value as Body[];
}
async function action(visitor: Visitor, id: string, name: string, version: number, role = 'buyer', data: Body = {}) {
  return raw(`/procurement/Cases(${id})/ProcurementService.${name}`, visitor, 'POST', { expectedVersion: version, ...data }, role);
}
async function prepare(visitor: Visitor, id: string, role = 'buyer') {
  const result = await action(visitor, id, 'prepare', 0, role, { offerID: OFFER, reason: 'Private decision', extraCostReason: 'Ensure delivery' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
}
function blocked(result: { status: number; body: Body }) { assert.ok([400, 401, 403, 404, 405].includes(result.status), JSON.stringify(result)); }

beforeEach(async () => {
  process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-19';
  await api.data.reset();
  await cds.db.run(DELETE.from('procurement.DemoSessions'));
});

describe('Public demo: isolated anonymous sessions through the real HTTP service', () => {
  it('boots without SAP credentials, issues a private cookie and keeps requests scoped to twelve cases', async () => {
    assert.equal((await raw('/app-config')).body.publicDemo, true);
    assert.equal((await raw('/procurement/Cases')).status, 401);
    assert.equal((await raw('/procurement/Cases', undefined, 'GET', undefined, 'buyer', { Authorization: 'Basic ' + Buffer.from('buyer:demo-buyer').toString('base64') })).status, 401);
    const a = await visit(), b = await visit();
    const aCases = await cases(a), bCases = await cases(b);
    assert.equal(aCases.length, 12); assert.equal(bCases.length, 12);
    assert.ok(aCases.every(row => !bCases.some(other => other.ID === row.ID)));
    for (const visitor of [a, b]) {
      const response = await read(visitor, 'cockpitSummary()');
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual([response.body.total, response.body.open, response.body.urgent], [12, 12, 4]);
      assert.equal((await read(visitor, 'Cases?$search=PF-2026-012')).body.value.length, 1);
      assert.equal((await read(visitor, "DecisionWorkspaces?$filter=IsActiveEntity eq true&$search=Motorregler 1049")).body.value.length, 1);
    }
    const again = await raw('/demo/session', a, 'POST', undefined, 'buyer', { 'X-Demo-Bootstrap': '1' });
    assert.equal(again.cookie, a.cookie);
    assert.equal((await cds.db.run(SELECT.one.from('procurement.Cases').columns('count(*) as total').where({ demoScope: 'shared' }))).total, 12);
    blocked(await read(a, 'DemoSessions'));
  });

  it('prevents cross-session reads, expansions, searches, actions and scope-header spoofing', async () => {
    const a = await visit(), b = await visit(); const id = (await cases(a))[0]!.ID;
    await prepare(a, id);
    assert.equal((await action(a, id, 'submit', 1)).status, 200);
    assert.equal((await action(a, id, 'approve', 2, 'approver')).status, 200);
    const submission = (await read(a, 'Submissions')).body.value[0];
    const transfer = (await read(a, 'Transfers')).body.value[0];
    for (const path of [`Cases(${id})`, `Cases(${id})/history`, `Cases(${id})/ProcurementService.compareOffers()`,
      `DecisionWorkspaces(ID=${id},IsActiveEntity=true)`, `Submissions(${submission.ID})`, `Transfers(${transfer.ID})`]) blocked(await read(b, path));
    for (const entity of ['History', 'Submissions', 'Transfers', 'TransferAttempts']) {
      assert.deepEqual((await read(b, entity)).body.value, []);
    }
    blocked(await action(b, id, 'prepare', 3, 'buyer', { offerID: OFFER }));
    blocked(await raw(`/procurement/Cases(${id})`, b, 'GET', undefined, 'buyer', { 'X-Demo-Scope': (await cases(a))[0]!.demoScope }));
    assert.equal((await read(b, 'History?$search=Private')).body.value.length, 0);
    const expanded = await read(b, "DecisionWorkspaces?$filter=IsActiveEntity eq true&$expand=procurementCase($expand=history,submissions)");
    assert.equal(expanded.status, 200, JSON.stringify(expanded.body));
    assert.ok(expanded.body.value.every((row: Body) => row.procurementCase.history.length === 0 && row.procurementCase.submissions.length === 0));
    assert.equal((await read(a, 'History')).body.value.length, 3);
  });

  it('isolates draft ownership, draft administration and activation even for the same chosen role', async () => {
    const a = await visit(), b = await visit(); const id = (await cases(a))[0]!.ID;
    const active = `DecisionWorkspaces(ID=${id},IsActiveEntity=true)`;
    const draft = `DecisionWorkspaces(ID=${id},IsActiveEntity=false)`;
    const edit = await raw('/procurement/' + active + '/ProcurementService.draftEdit', a, 'POST', { PreserveChanges: true });
    assert.equal(edit.status, 201, JSON.stringify(edit.body));
    const patched = await raw('/procurement/' + draft, a, 'PATCH', { selectedOffer_ID: OFFER, reason: 'Private draft', extraCostReason: 'Ensure delivery' });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    blocked(await read(b, draft));
    blocked(await raw('/procurement/' + active + '/ProcurementService.draftEdit', b, 'POST', { PreserveChanges: true }));
    blocked(await raw('/procurement/' + draft, b, 'PATCH', { reason: 'Intrusion' }));
    blocked(await raw('/procurement/' + draft + '/ProcurementService.draftActivate', b, 'POST', {}));
    blocked(await raw('/procurement/' + draft, b, 'DELETE'));
    const bDrafts = await read(b, 'DecisionWorkspaces?$filter=IsActiveEntity eq false');
    assert.equal(bDrafts.status, 200); assert.equal(bDrafts.body.value.length, 0);
    const admin = await read(a, draft + '?$expand=DraftAdministrativeData');
    assert.equal(admin.body.reason, 'Private draft');
    const uuid = admin.body.DraftAdministrativeData.DraftUUID;
    blocked(await read(b, `DraftAdministrativeData(DraftUUID=${uuid})`));
    assert.equal((await read(a, draft + '/DraftAdministrativeData')).status, 200);
    blocked(await read(b, draft + '/DraftAdministrativeData'));
    const saved = await raw('/procurement/' + draft + '/ProcurementService.draftActivate', a, 'POST', {});
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  });

  it('enforces roles and CSRF while allowing only the public Dual identity to approve its own submission', async () => {
    const a = await visit(); const id = (await cases(a))[0]!.ID;
    blocked(await action(a, id, 'prepare', 0, 'reader', { offerID: OFFER }));
    blocked(await action(a, id, 'prepare', 0, 'approver', { offerID: OFFER }));
    blocked(await read(a, 'Cases', 'admin'));
    blocked(await raw('/procurement/Cases', a, 'POST', {}, 'dual'));
    blocked(await raw(`/procurement/Cases(${id})/ProcurementService.prepare`, { ...a, csrf: 'wrong' }, 'POST', { expectedVersion: 0, offerID: OFFER }));
    blocked(await raw('/demo/reset', { ...a, csrf: 'é'.repeat(64) }, 'POST', undefined, 'buyer', { 'X-Demo-Bootstrap': '1' }));
    blocked(await raw('/demo/reset', a, 'POST', undefined, 'buyer', { Origin: 'https://example.invalid', 'X-Demo-Bootstrap': '1' }));
    await prepare(a, id, 'dual');
    assert.equal((await action(a, id, 'submit', 1, 'dual')).status, 200);
    const workspace = `DecisionWorkspaces(ID=${id},IsActiveEntity=true)`;
    assert.equal((await read(a, workspace, 'dual')).body.canApprove, true);
    assert.equal((await read(a, workspace, 'buyer')).body.canApprove, false);
    assert.equal((await read(a, workspace, 'reader')).body.canApprove, false);
    blocked(await action(a, id, 'approve', 2, 'buyer'));
    blocked(await action(a, id, 'approve', 2, 'reader'));
    const other = await visit();
    blocked(await action(other, id, 'approve', 2, 'dual'));
    const results = await Promise.all([action(a, id, 'approve', 2, 'dual'), action(a, id, 'approve', 2, 'dual')]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal((await read(a, `Cases(${id})`)).body.status, 'Approved');
    assert.equal((await read(a, 'Transfers')).body.value.length, 1);
    const submission = (await read(a, 'Submissions')).body.value[0];
    const approval = await cds.db.run(SELECT.one.from('procurement.History').where({ procurementCase_ID: id, event: 'Approved' }));
    assert.equal(approval.actor, submission.submittedBy, 'Demo self-approval must retain the actual submitting identity');
    assert.match(approval.actor, /^demo:[0-9a-f-]{36}:dual$/);
  });

  it('restarts only the visitor, invalidates the old session and preserves the other visitor', async () => {
    const a = await visit(), b = await visit(); const idA = (await cases(a))[0]!.ID, idB = (await cases(b))[0]!.ID;
    await prepare(a, idA); await prepare(b, idB);
    const reset = await raw('/demo/reset', a, 'POST', undefined, 'buyer', { 'X-Demo-Bootstrap': '1' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    const fresh = { cookie: reset.cookie, csrf: reset.body.csrfToken };
    assert.equal((await read(a, 'Cases')).status, 401);
    assert.ok((await cases(fresh)).every(row => row.version === 0 && row.reason == null && row.ID !== idA));
    assert.equal((await read(b, `Cases(${idB})`)).body.reason, 'Private decision');
    assert.equal(await cleanExpiredSessions(Date.now() + 16 * 60000), 1);
    assert.equal((await cds.db.run(SELECT.one.from('procurement.Cases').columns('count(*) as total'))).total, 36);
    assert.equal((await cds.db.run(SELECT.one.from('procurement.History').columns('count(*) as total'))).total, 1);
  });

  it('lets an active ERP request finish before cleanup and removes abandoned jobs and attempts later', async () => {
    const a = await visit(), b = await visit(); const item = (await cases(a))[0]!;
    await prepare(a, item.ID);
    assert.equal((await action(a, item.ID, 'submit', 1)).status, 200);
    assert.equal((await action(a, item.ID, 'approve', 2, 'approver')).status, 200);
    const job = (await read(a, 'Transfers')).body.value[0];
    const worker = new OrderWorker({ send: async () => { throw new Error('This test must not send an order'); } }, { leaseMs: 3600000 });
    assert.ok(await worker.claim(job.ID));
    await cds.db.run(UPDATE.entity('procurement.DemoSessions').set({ expiresAt: new Date(Date.now() - 3600000).toISOString() }).where({ ID: item.demoScope }));
    assert.equal(await cleanExpiredSessions(), 0);
    await cds.db.run(UPDATE.entity('procurement.Transfers').set({ leaseUntil: new Date(Date.now() - 1000).toISOString() }).where({ ID: job.ID }));
    assert.equal(await cleanExpiredSessions(), 1);
    for (const table of ['Transfers', 'TransferAttempts', 'History', 'Submissions']) {
      assert.equal((await cds.db.run(SELECT.one.from('procurement.' + table).columns('count(*) as total'))).total, 0);
    }
    assert.equal((await cases(b)).length, 12);
  });

  it('expires sessions and deletes their drafts without touching live visitors or shared cases', async () => {
    const a = await visit(), b = await visit(); const item = (await cases(a))[0]!;
    const draft = await raw(`/procurement/DecisionWorkspaces(ID=${item.ID},IsActiveEntity=true)/ProcurementService.draftEdit`, a, 'POST', { PreserveChanges: true });
    assert.equal(draft.status, 201);
    await cds.db.run(UPDATE.entity('procurement.DemoSessions').set({ expiresAt: new Date(Date.now() - 3600000).toISOString() }).where({ ID: item.demoScope }));
    assert.equal((await read(a, 'Cases')).status, 401);
    assert.equal(await cleanExpiredSessions(), 1);
    assert.equal((await cds.db.run(SELECT.from('ProcurementService.DecisionWorkspaces.drafts')) as unknown[]).length, 0);
    assert.equal((await cds.db.run(SELECT.from('DRAFT.DraftAdministrativeData')) as unknown[]).length, 0);
    assert.equal((await cases(b)).length, 12);
    assert.equal((await cds.db.run(SELECT.one.from('procurement.Cases').columns('count(*) as total'))).total, 24);
  });
});

const scenario = (visitor: Visitor, value?: string, extra: Body = {}) => raw('/demo/scenario', visitor,
  value === undefined ? 'GET' : 'POST', value === undefined ? undefined : { scenario: value, ...extra });

describe('Public demo: personal ERP outage scenario', () => {
  it('persists only the cookie owner setting, rejects forged writes and resets only that visitor', async () => {
    const a = await visit(), b = await visit();
    assert.equal((await scenario(a)).body.scenario, 'normal');
    assert.equal((await raw('/demo/scenario')).status, 401);
    assert.equal((await raw('/demo/scenario', undefined, 'POST', { scenario: 'erp-outage' })).status, 401);
    assert.equal((await scenario({ ...a, csrf: 'invalid' }, 'erp-outage')).status, 403);
    assert.equal((await raw('/demo/scenario', a, 'POST', { scenario: 'erp-outage' }, 'buyer', { Origin: 'https://example.invalid' })).status, 403);
    for (const value of ['global', 'drop-after-commit-once', '']) assert.equal((await scenario(a, value)).status, 400);
    assert.equal((await scenario(a, 'erp-outage', { sessionID: (await cases(b))[0]!.demoScope })).status, 400);
    assert.equal((await scenario(a, 'erp-outage')).status, 200);
    assert.equal((await scenario(a)).body.scenario, 'erp-outage');
    assert.equal((await scenario(b)).body.scenario, 'normal');
    const again = await raw('/demo/session', a, 'POST', undefined, 'reader', { 'X-Demo-Bootstrap': '1' });
    assert.equal(again.body.scenario, 'erp-outage');
    assert.equal(again.cookie, a.cookie);
    assert.ok((await cases(a)).every(row => row.version === 0 && row.status === 'Open'));
    // Scenario selection is a visitor preference, not permission to edit procurement decisions.
    assert.equal((await raw('/demo/scenario', b, 'POST', { scenario: 'erp-outage' }, 'reader')).status, 200);
    const reset = await raw('/demo/reset', a, 'POST', undefined, 'buyer', { 'X-Demo-Bootstrap': '1' });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.scenario, 'normal');
    assert.equal((await scenario(a)).status, 401);
    assert.equal((await scenario(a, 'normal')).status, 401);
    assert.equal((await scenario(b)).body.scenario, 'erp-outage');
  });

  it('runs bounded real transfer failures only for that visitor, then confirms one HTTP order on retry', async () => {
    const database = erpDatabase();
    const erp = await startErp(database);
    try {
      const a = await visit(), b = await visit();
      const idA = (await cases(a))[0]!.ID, idB = (await cases(b))[0]!.ID;
      assert.equal((await scenario(a, 'erp-outage')).status, 200);
      for (const [visitor, id] of [[a, idA], [b, idB]] as const) {
        await prepare(visitor, id);
        assert.equal((await action(visitor, id, 'submit', 1)).status, 200);
        assert.equal((await action(visitor, id, 'approve', 2, 'approver')).status, 200);
      }
      const before = await cds.db.run(SELECT.one.from('procurement.Transfers').where({ procurementCase_ID: idA }));
      let now = Date.now() + 1000;
      const transport = new HttpOrderTransport(erp.url, 'integration', 'demo-integration');
      const options = { now: () => now, maxAttempts: 2, baseRetryMs: 10 };
      const worker = new OrderWorker(transport, options);
      assert.equal(await worker.runDue(10), 2);
      let job = (await read(a, 'Transfers')).body.value[0];
      assert.equal(job.status, 'Retry');
      assert.equal(job.lastErrorCode, 'ERP_DEMO_OUTAGE');
      assert.equal(job.attemptCount, 1);
      assert.equal((await read(a, `Cases(${idA})`)).body.status, 'Approved');
      const bOrder = (await read(b, `Cases(${idB})`)).body;
      assert.equal(bOrder.status, 'Ordered');
      const orders = async () => {
        const response = await fetch(erp.url + '/erp/Orders', { headers: erpAuth() });
        assert.equal(response.status, 200); return await response.json() as Body[];
      };
      assert.deepEqual((await orders()).map(row => row.caseID), [idB]);
      assert.equal(await worker.runDue(10), 0, 'backoff must be respected');
      now += 10;
      // A fresh worker reads the persisted scenario; the setting is not process-local.
      assert.equal(await new OrderWorker(transport, options).runDue(10), 1);
      job = (await read(a, 'Transfers')).body.value[0];
      assert.equal(job.status, 'Failed');
      assert.equal(job.attemptCount, 2);
      assert.equal((await scenario(a, 'normal')).status, 200);
      assert.equal((await action(a, idA, 'retryTransfer', 3, 'reader')).status, 403);
      assert.equal((await action(a, idA, 'retryTransfer', 3)).status, 200);
      assert.equal(await worker.runDue(10), 1);
      const after = await cds.db.run(SELECT.one.from('procurement.Transfers').where({ procurementCase_ID: idA }));
      assert.deepEqual([after.ID, after.payload, after.payloadHash], [before.ID, before.payload, before.payloadHash]);
      assert.equal(after.status, 'Succeeded');
      assert.equal((await orders()).length, 2);
      assert.equal((await orders()).filter(row => row.caseID === idA).length, 1);
      assert.deepEqual((await read(a, 'TransferAttempts?$orderby=attemptNumber')).body.value.map((row: Body) => row.outcome), ['Retry', 'Failed', 'Succeeded']);
      assert.equal((await read(a, `Cases(${idA})`)).body.status, 'Ordered');
      await scenario(a, 'erp-outage');
      assert.equal(await worker.runDue(10), 0);
      assert.equal((await orders()).length, 2, 'completed orders must not be changed by the scenario');
      assert.equal((await read(b, `Cases(${idB})`)).body.orderNumber, bOrder.orderNumber);
    } finally { await erp.stop(); await removeErpDatabase(database); }
  });

  it('allows an already dispatched request to finish when the visitor enables the scenario', async () => {
    const a = await visit(), id = (await cases(a))[0]!.ID;
    await prepare(a, id);
    await action(a, id, 'submit', 1); await action(a, id, 'approve', 2, 'approver');
    const job = await cds.db.run(SELECT.one.from('procurement.Transfers').where({ procurementCase_ID: id }));
    let dispatched!: () => void, finish!: () => void;
    const sent = new Promise<void>(resolve => { dispatched = resolve; });
    const release = new Promise<void>(resolve => { finish = resolve; });
    const worker = new OrderWorker({ send: async () => {
      dispatched(); await release;
      return { operationID: job.ID, payloadHash: job.payloadHash, orderNumber: 'SIM-' + job.ID.replaceAll('-', '').toUpperCase(), createdAt: new Date().toISOString() };
    } }, { now: () => Date.now() + 1000 });
    const running = worker.runDue();
    try { await sent; assert.equal((await scenario(a, 'erp-outage')).status, 200); }
    finally { finish(); await running; }
    assert.equal((await read(a, `Cases(${id})`)).body.status, 'Ordered');
    assert.equal((await read(a, 'Transfers')).body.value[0].status, 'Succeeded');
  });
});
