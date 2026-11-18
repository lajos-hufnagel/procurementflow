import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const api = cds.test('serve', '--in-memory') as ReturnType<typeof cds.test> & { url: string };
const ID = '50000000-0000-4000-8000-000000000001';
const A = '40000000-0000-4000-8000-000000000002';
const B = '40000000-0000-4000-8000-000000000003';
const active = `DecisionWorkspaces(ID=${ID},IsActiveEntity=true)`;
const draft = `DecisionWorkspaces(ID=${ID},IsActiveEntity=false)`;
const { SELECT } = cds.ql;
type Body = Record<string, any>;
async function request(path: string, method = 'GET', body?: Body, user = 'buyer') {
  const headers: Record<string, string> = {
    Authorization: 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64'),
    'Accept-Language': 'de', 'If-Match': '*'
  };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(api.url + '/procurement/' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let data: Body;
  try { data = JSON.parse(raw); } catch { data = { text: raw }; }
  return { status: response.status, body: data };
}
const edit = (user = 'buyer') => request(active + '/ProcurementService.draftEdit', 'POST', { PreserveChanges: true }, user);
const patch = (body: Body, user = 'buyer') => request(draft, 'PATCH', body, user);
const save = (user = 'buyer') => request(draft + '/ProcurementService.draftActivate', 'POST', {}, user);
const action = (name: string, version: number, body: Body = {}, user = 'buyer') =>
  request(`Cases(${ID})/ProcurementService.${name}`, 'POST', { expectedVersion: version, ...body }, user);
const inputs = { selectedOffer_ID: A, reason: 'Lieferengpass vermeiden', extraCostReason: 'Fertigung rechtzeitig versorgen' };
async function preparedDraft(user = 'buyer') {
  ok(await edit(user), 201);
  ok(await patch(inputs, user), 200);
}
async function state() { return (await request(`Cases(${ID})`)).body; }
async function history() { return await cds.db.run(SELECT.from('procurement.History')) as Body[]; }
function ok(response: Awaited<ReturnType<typeof request>>, status: number) {
  assert.equal(response.status, status, JSON.stringify(response.body));
}
function blocked(response: Awaited<ReturnType<typeof request>>) {
  assert.ok([400, 403, 404, 405, 409, 412].includes(response.status), JSON.stringify(response));
}

beforeEach(async () => {
  process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-19';
  await api.data.reset();
});

describe('M2: server drafts and shared workflow', () => {
  it('finds cases by number and material through the real list search', async () => {
    for (const term of ['PF-2026-001', 'WM-240']) {
      const result = await request('DecisionWorkspaces?$search=' + encodeURIComponent(term) + '&$filter=IsActiveEntity%20eq%20true');
      ok(result, 200);
      assert.equal(result.body.value.length, 1);
      assert.equal(result.body.value[0].ID, ID);
    }
    const empty = await request('DecisionWorkspaces?$search=unbekanntesmaterial&$filter=IsActiveEntity%20eq%20true');
    ok(empty, 200);
    assert.equal(empty.body.value.length, 0);
  });

  it('resumes persisted inputs and activates one atomic prepare, not a submission', async () => {
    await preparedDraft();
    const resumed = await request(draft);
    ok(resumed, 200);
    assert.equal(resumed.body.reason, inputs.reason);
    assert.equal(resumed.body.baseCaseVersion, 0);
    assert.equal((await state()).version, 0);
    assert.equal((await history()).length, 0);
    ok(await save(), 200);
    const saved = await state();
    assert.equal(saved.version, 1);
    assert.equal(saved.status, 'Open');
    assert.equal(saved.totalCost, '2600.00');
    assert.equal(saved.extraCost, '600.00');
    assert.equal(saved.submissionSequence, 0);
    const workspace = (await request(active)).body;
    assert.equal(workspace.baseCaseVersion, 1);
    assert.equal(workspace.reason, inputs.reason);
    assert.equal(workspace.HasDraftEntity, false);
    assert.equal((await history()).length, 1);
    assert.equal((await history())[0]!.event, 'Prepared');
    ok(await request(draft), 404);
  });
  it('rejects an older draft ETag instead of losing a same-user change', async () => {
    ok(await edit(), 201);
    const before = (await request(draft)).body['@odata.etag'];
    assert.ok(before);
    ok(await patch(inputs), 200);
    const response = await fetch(api.url + '/procurement/' + draft, {
      method: 'PATCH', headers: {
        Authorization: 'Basic ' + Buffer.from('buyer:demo-buyer').toString('base64'),
        'Content-Type': 'application/json', 'If-Match': before
      }, body: JSON.stringify({ reason: 'Veralteter Stand' })
    });
    assert.equal(response.status, 412, await response.text());
    assert.equal((await request(draft)).body.reason, inputs.reason);
  });
  it('discards only the draft, preserving active case and its history', async () => {
    await preparedDraft();
    ok(await request(draft, 'DELETE'), 204);
    assert.equal((await state()).version, 0);
    assert.equal((await request(active)).body.HasDraftEntity, false);
    assert.equal((await history()).length, 0);
  });
  it('allows correction after failed validation and keeps all business effects rolled back', async () => {
    ok(await edit(), 201);
    const failed = await save();
    ok(failed, 400);
    assert.equal(failed.body.error.code, 'OFFER_REQUIRED');
    ok(await request(draft), 200);
    assert.equal((await state()).version, 0);
    assert.equal((await history()).length, 0);
    ok(await patch(inputs), 200);
    ok(await save(), 200);
  });
  it('preserves four eyes for decisions originating from a draft', async () => {
    await preparedDraft('dual');
    ok(await save('dual'), 200);
    ok(await action('submit', 1, {}, 'dual'), 200);
    const self = await action('approve', 2, {}, 'dual');
    ok(self, 403);
    assert.equal(self.body.error.code, 'SELF_APPROVAL');
    ok(await action('approve', 2, {}, 'approver'), 200);
    assert.equal((await state()).status, 'Approved');
    blocked(await edit());
  });
  it('keeps active workspace aligned with changes from the other frontend', async () => {
    ok(await action('prepare', 0, { offerID: B, reason: 'Andere Auswahl', extraCostReason: '' }), 200);
    const workspace = (await request(active)).body;
    assert.equal(workspace.selectedOffer_ID, B);
    assert.equal(workspace.baseCaseVersion, 1);
    ok(await edit(), 201);
    const opened = (await request(draft)).body;
    assert.equal(opened.selectedOffer_ID, B);
    assert.equal(opened.baseCaseVersion, 1);
  });
});

describe('M2: draft authorization and protected fields', () => {
  for (const user of ['reader', 'approver']) {
    it(`${user} can read active workspaces but cannot edit, patch or activate`, async () => {
      ok(await request(active, 'GET', undefined, user), 200);
      blocked(await edit(user));
      await preparedDraft();
      blocked(await patch({ reason: 'Fremder Eingriff' }, user));
      blocked(await save(user));
      blocked(await request(draft, 'DELETE', undefined, user));
      assert.equal((await request(draft)).body.reason, inputs.reason);
    });
  }
  it('prevents another Buyer from editing, deleting or activating an owned draft', async () => {
    await preparedDraft();
    blocked(await edit('dual'));
    blocked(await patch({ reason: 'Übernahmeversuch' }, 'dual'));
    blocked(await save('dual'));
    blocked(await request(draft, 'DELETE', undefined, 'dual'));
    assert.equal((await request(draft)).body.reason, inputs.reason);
    assert.equal((await state()).version, 0);
  });
  it('cannot change the case assignment or stored version through draft fields', async () => {
    await preparedDraft();
    for (const data of [
      { baseCaseVersion: 99, reason: 'Version gefälscht' },
      { procurementCase_ID: '50000000-0000-4000-8000-000000000099' },
      { procurementCase: { ID, status: 'Approved' } },
      { selectedOffer: { ID: A, unitPrice: '0.00' } }
    ]) {
      const response = await patch(data);
      assert.ok([200, 400, 403].includes(response.status), JSON.stringify(response));
      const stored = (await request(draft)).body;
      assert.equal(stored.baseCaseVersion, 0);
      assert.equal(stored.procurementCase_ID, ID);
    }
    assert.equal((await state()).status, 'Open');
    assert.equal((await request(`Offers(${A})`)).body.unitPrice, '125.00');
    ok(await save(), 200);
    assert.equal((await state()).totalCost, '2600.00');
  });
  it('blocks active writes, creation, deletion and navigation bypasses', async () => {
    for (const [path, method, data] of [
      [active, 'PATCH', { selectedOffer_ID: A }],
      [`DecisionWorkspaces(${ID})`, 'PATCH', { selectedOffer_ID: A }],
      ['DecisionWorkspaces', 'POST', { ID: '60000000-0000-4000-8000-000000000099', IsActiveEntity: false }],
      ['DecisionWorkspaces', 'POST', { ID, IsActiveEntity: true }],
      [active, 'DELETE', undefined],
      [active + '/procurementCase', 'PATCH', { status: 'Approved' }]
    ] as const) {
      const result = await request(path, method, data);
      if (result.status === 501) assert.match(result.body.error.message, /bypass_draft/);
      else blocked(result);
    }
    await preparedDraft();
    ok(await request(active, 'PATCH', { selectedOffer_ID: B, reason: 'Aktive Umgehung' }), 501);
    assert.equal((await state()).version, 0);
    assert.equal((await request(draft)).body.selectedOffer_ID, A);
    const batch = await request('$batch', 'POST', { requests: [{
      id: '1', method: 'PATCH', url: active,
      headers: { 'content-type': 'application/json' }, body: { selectedOffer_ID: B }
    }] });
    ok(batch, 200);
    assert.ok([400, 403, 405, 501].includes(batch.body.responses[0].status));
    assert.equal((await state()).version, 0);
  });
});

describe('M2: stale drafts, concurrency and atomicity', () => {
  it('rejects a stale draft after a change from the other frontend without losing the draft', async () => {
    await preparedDraft();
    ok(await action('prepare', 0, { offerID: B, reason: 'Neue Entscheidung' }), 200);
    assert.equal((await request(draft)).body.baseCaseVersion, 0);
    const failed = await save();
    ok(failed, 409);
    assert.equal(failed.body.error.code, 'STALE_VERSION');
    assert.equal((await state()).selectedOffer_ID, B);
    assert.equal((await state()).version, 1);
    assert.equal((await request(draft)).body.selectedOffer_ID, A);
    ok(await request(draft, 'DELETE'), 204);
    ok(await edit(), 201);
    assert.equal((await request(draft)).body.baseCaseVersion, 1);
  });
  for (const lastAction of ['submit', 'withdraw', 'approve']) {
    it(`cannot overwrite a case after ${lastAction} with an earlier draft`, async () => {
      ok(await action('prepare', 0, { offerID: A, reason: inputs.reason, extraCostReason: inputs.extraCostReason }), 200);
      await preparedDraft();
      ok(await action('submit', 1), 200);
      if (lastAction === 'withdraw') ok(await action('withdraw', 2), 200);
      if (lastAction === 'approve') ok(await action('approve', 2, {}, 'approver'), 200);
      const before = await state();
      const failed = await save();
      ok(failed, 409);
      assert.equal(failed.body.error.code, 'STALE_VERSION');
      assert.deepEqual(await state(), before);
      assert.equal((await request(draft)).body.baseCaseVersion, 1);
    });
  }
  it('does not duplicate a business change under concurrent activation', async () => {
    await preparedDraft();
    const results = await Promise.all([save(), save()]);
    assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results));
    blocked(results.find(r => r.status !== 200)!);
    assert.equal((await state()).version, 1);
    assert.equal((await history()).length, 1);
  });
  it('does not save a case without its required editing workspace', async () => {
    await cds.db.run(cds.ql.DELETE.from('procurement.DecisionWorkspaces').where({ ID }));
    const result = await action('prepare', 0, { offerID: A, reason: 'Versuch ohne Workspace' });
    ok(result, 409);
    assert.equal(result.body.error.code, 'WORKSPACE_ASSIGNMENT_INVALID');
    assert.equal((await state()).version, 0);
    assert.equal((await history()).length, 0);
  });
  it('rolls back case, history and workspace together when workspace persistence fails', async () => {
    await preparedDraft();
    await cds.db.run(`CREATE TEMP TRIGGER fail_workspace BEFORE UPDATE ON procurement_DecisionWorkspaces
      WHEN NEW.baseCaseVersion = 1 BEGIN SELECT RAISE(ABORT, 'test: workspace unavailable'); END`);
    try { ok(await save(), 500); }
    finally { await cds.db.run('DROP TRIGGER fail_workspace'); }
    assert.equal((await state()).version, 0);
    assert.equal((await state()).selectedOffer_ID, null);
    assert.equal((await history()).length, 0);
    assert.equal((await request(active)).body.baseCaseVersion, 0);
    assert.equal((await request(draft)).body.reason, inputs.reason);
    ok(await save(), 200);
  });
});
