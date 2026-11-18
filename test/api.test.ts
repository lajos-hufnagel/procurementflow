import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const api = cds.test('serve', '--in-memory') as ReturnType<typeof cds.test> & { url: string };
const CASE = '50000000-0000-4000-8000-000000000001';
const OFFER_A = '40000000-0000-4000-8000-000000000002';
const OFFER_B = '40000000-0000-4000-8000-000000000003';
const { SELECT, UPDATE } = cds.ql;
const cases = 'procurement.Cases';
const offers = 'procurement.Offers';
const history = 'procurement.History';
const submissions = 'procurement.Submissions';
const casePath = `Cases(${CASE})`;

// Responses deliberately stay flexible: the HTTP assertions validate their actual shape.
type Body = Record<string, any>;
async function request(path: string, user: string | null = 'buyer', method = 'GET', body?: Body, locale = 'de') {
  const headers: Record<string, string> = { 'Accept-Language': locale };
  if (user) headers.Authorization = 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64');
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(api.url + '/procurement/' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  let data: Body;
  try { data = JSON.parse(raw); } catch { data = { text: raw }; }
  return { status: response.status, body: data, headers: response.headers };
}
const action = (name: string, version: number, user = 'buyer', data: Body = {}) =>
  request(`${casePath}/ProcurementService.${name}`, user, 'POST', { expectedVersion: version, ...data });
const prepare = (user = 'buyer', offerID = OFFER_A, data: Body = {}) => action('prepare', 0, user, {
  offerID, reason: 'Fertigungsauftrag rechtzeitig versorgen', extraCostReason: 'Mehrkosten verhindern den Lieferengpass', ...data
});
async function submit(user = 'buyer', offerID = OFFER_A) {
  assert.equal((await prepare(user, offerID)).status, 200);
  const response = await action('submit', 1, user);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response;
}
async function state() { return (await request(casePath)).body; }
async function records(entity: string) { return await cds.db.run(SELECT.from(entity)) as Body[]; }
async function changeOffer(values: Body, id = OFFER_A) {
  await cds.db.run(UPDATE.entity(offers).set(values).where({ ID: id }));
}
function error(response: Awaited<ReturnType<typeof request>>, status: number, code?: string) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  if (code) assert.equal(response.body.error.code, code);
}

beforeEach(async () => {
  process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-19';
  await api.data.reset();
});

describe('M1: OData contract and explicit local identities', () => {
  it('does not expose public scenario controls outside the public-demo profile', async () => {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(api.url + '/demo/scenario', { method, headers: {
        'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('dual:demo-dual').toString('base64')
      }, body: method === 'POST' ? JSON.stringify({ scenario: 'erp-outage' }) : undefined });
      assert.equal(response.status, 404);
    }
  });
  it('serves actual OData V4 metadata and the seeded scenario', async () => {
    const metadata = await request('$metadata', 'reader');
    assert.equal(metadata.status, 200);
    assert.match(metadata.body.text, /Action Name="approve"/);
    const response = await request(`Cases?$filter=ID eq ${CASE}&$expand=demand,referenceOffer`, 'reader');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('odata-version'), '4.0');
    assert.equal(response.body.value.length, 1);
    assert.equal(response.body.value[0].demand.quantity, 20);
    assert.equal(response.body.value[0].referenceTotal, '2000.00');
    assert.equal((await request(`Offers?$filter=material_ID eq 10000000-0000-4000-8000-000000000001`, 'reader')).body.value.length, 3);
  });
  it('requires a known identity and exposes only its configured roles', async () => {
    error(await request('Cases', null), 401);
    error(await request('Cases', 'unknown'), 401);
    const wrongPassword = await fetch(api.url + '/procurement/Cases', { headers: { Authorization: 'Basic ' + Buffer.from('buyer:wrong-password').toString('base64') } });
    assert.equal(wrongPassword.status, 401);
    const response = await request('session()', 'reader');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.roles, ['Reader']);
    assert.equal(response.body.evaluationDate, '2026-11-19');
  });
});

describe('M1: calculations and complete business flow', () => {
  it('computes A in the backend and freezes the submitted conditions', async () => {
    const response = await prepare();
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.totalCost, '2600.00');
    assert.equal(response.body.extraCost, '600.00');
    assert.equal(response.body.delayDays, 0);
    assert.equal((await action('submit', 1)).status, 200);
    const approved = await action('approve', 2, 'approver');
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, 'Approved');
    assert.equal(approved.body.version, 3);
    assert.equal(approved.body.orderNumber, null);
    const snapshots = await records(submissions);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]!.submittedBy, 'buyer');
    assert.equal(snapshots[0]!.evaluatedOn, '2026-11-19');
    assert.equal(Number(snapshots[0]!.totalCost), 2600);
    const events = await cds.db.run(SELECT.from(history).orderBy('caseVersion')) as Body[];
    assert.deepEqual(events.map((entry: Body) => entry.event), ['Prepared', 'Submitted', 'Approved']);
    assert.equal(events[2]!.actor, 'approver');
  });
  it('computes B and still requires an approval below the extra-cost threshold', async () => {
    const response = await prepare('buyer', OFFER_B, { extraCostReason: '' });
    assert.equal(response.body.totalCost, '2250.00');
    assert.equal(response.body.extraCost, '250.00');
    assert.equal(response.body.delayDays, 4);
    assert.equal((await action('submit', 1)).body.status, 'Submitted');
    assert.equal((await action('approve', 2, 'approver')).body.status, 'Approved');
  });
  for (const amount of ['499.99', '500.00', '500.01']) {
    it(`enforces the additional explanation at ${amount} euros`, async () => {
      await changeOffer({ unitPrice: '100.00', shipping: amount });
      const response = await prepare('buyer', OFFER_A, { extraCostReason: '   ' });
      assert.equal(response.body.extraCost, amount);
      const submitted = await action('submit', 1);
      if (amount === '499.99') assert.equal(submitted.status, 200);
      else {
        error(submitted, 400, 'EXTRA_REASON_REQUIRED');
        assert.equal((await state()).version, 1);
        assert.equal((await records(submissions)).length, 0);
      }
    });
  }
  it('keeps the original reference costs when the source quote later changes', async () => {
    await changeOffer({ unitPrice: '300.00', version: 2 }, '40000000-0000-4000-8000-000000000001');
    assert.equal((await prepare()).body.extraCost, '600.00');
  });
  it('returns business validation messages in German and English', async () => {
    await prepare('buyer', OFFER_A, { reason: '' });
    const path = `${casePath}/ProcurementService.submit`;
    const de = await request(path, 'buyer', 'POST', { expectedVersion: 1 }, 'de');
    const en = await request(path, 'buyer', 'POST', { expectedVersion: 1 }, 'en');
    error(de, 400, 'REASON_REQUIRED');
    error(en, 400, 'REASON_REQUIRED');
    assert.match(de.body.error.message, /begründen/);
    assert.match(en.body.error.message, /Explain/);
  });
  for (const reason of ['', '   ']) {
    it(`rejects an empty business explanation (${JSON.stringify(reason)}) without partial effects`, async () => {
      await prepare('buyer', OFFER_A, { reason });
      error(await action('submit', 1), 400, 'REASON_REQUIRED');
      assert.equal((await state()).status, 'Open');
      assert.equal((await state()).version, 1);
      assert.equal((await records(history)).length, 1);
    });
  }
});

describe('M1: offer validation, validity and revision history', () => {
  for (const patch of [
    { quantity: 19 }, { quantity: 21 }, { quantity: 0 }, { unit: 'KG' },
    { currency: 'USD' }, { unitPrice: '-0.01' }, { shipping: '-0.01' },
    { material_ID: '10000000-0000-4000-8000-000000000099' }
  ]) {
    it(`rejects a mismatching offer ${JSON.stringify(patch)}`, async () => {
      await changeOffer(patch);
      error(await prepare(), 400);
      assert.equal((await state()).version, 0);
      assert.equal((await records(history)).length, 0);
    });
  }
  it('detects price changes even without an incremented source version', async () => {
    await submit();
    await changeOffer({ unitPrice: '126.00' });
    error(await action('approve', 2, 'approver'), 409, 'OFFER_CHANGED');
    assert.equal((await state()).status, 'Submitted');
    assert.equal((await state()).version, 2);
    assert.equal(Number((await records(submissions))[0]!.unitPrice), 125);
  });
  it('does not silently accept changed prices at submission either', async () => {
    await prepare();
    await changeOffer({ shipping: '150.00' });
    error(await action('submit', 1), 409, 'OFFER_CHANGED');
    assert.equal((await records(submissions)).length, 0);
  });
  it('allows the final validity day', async () => {
    await submit();
    process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-21';
    assert.equal((await action('approve', 2, 'approver')).status, 200);
  });
  it('recovers an expired submission through withdrawal and a new valid offer', async () => {
    await submit();
    process.env.PROCUREMENT_EVALUATION_DATE = '2026-11-22';
    error(await action('approve', 2, 'approver'), 409, 'OFFER_EXPIRED');
    assert.equal((await action('withdraw', 2)).body.status, 'Open');
    error(await action('submit', 3), 409, 'OFFER_EXPIRED');
    assert.equal((await action('prepare', 3, 'buyer', {
      offerID: OFFER_B, reason: 'Gültiges Ersatzangebot', extraCostReason: ''
    })).status, 200);
    assert.equal((await action('submit', 4)).status, 200);
    assert.equal((await action('approve', 5, 'approver')).status, 200);
    const snapshots = await cds.db.run(SELECT.from(submissions).orderBy('revision')) as Body[];
    assert.deepEqual(snapshots.map((row: Body) => row.revision), [1, 2]);
    assert.deepEqual(snapshots.map((row: Body) => row.offer_ID), [OFFER_A, OFFER_B]);
  });
  it('retains rejection and earlier revisions after rework', async () => {
    await submit();
    error(await action('decline', 2, 'approver', { reason: '   ' }), 400, 'ASSERT_MANDATORY');
    assert.equal((await action('decline', 2, 'approver', { reason: 'Bitte günstigere Alternative prüfen' })).body.status, 'Rejected');
    error(await action('approve', 3, 'approver'), 409, 'INVALID_STATE');
    assert.equal((await action('reopen', 3)).body.status, 'Open');
    assert.equal((await action('submit', 4)).status, 200);
    assert.equal((await action('approve', 5, 'approver')).status, 200);
    assert.equal((await records(submissions)).length, 2);
    const rejected = await cds.db.run(SELECT.one.from(history).where({ event: 'Rejected' })) as Body;
    assert.equal(rejected.reason, 'Bitte günstigere Alternative prüfen');
  });
});

describe('M1: authorization and immutable records', () => {
  it('rejects writes for readers and restricts the two operative roles', async () => {
    error(await prepare('reader'), 403);
    error(await prepare('approver'), 403);
    await submit();
    error(await action('approve', 2, 'buyer'), 403);
    assert.equal((await state()).version, 2);
  });
  it('enforces four eyes outside public-demo even with both roles and forged demo headers', async () => {
    await submit('dual');
    error(await action('approve', 2, 'dual'), 403, 'SELF_APPROVAL');
    const spoofed = await fetch(api.url + '/procurement/' + casePath + '/ProcurementService.approve', {
      method: 'POST', headers: {
        Authorization: 'Basic ' + Buffer.from('dual:demo-dual').toString('base64'),
        'Content-Type': 'application/json', 'X-Demo-Role': 'dual',
        'X-Demo-Scope': '50000000-0000-4000-8000-000000000001', 'X-Demo-Self-Approval': 'true'
      }, body: JSON.stringify({ expectedVersion: 2 })
    });
    assert.equal(spoofed.status, 403);
    assert.equal((await spoofed.json()).error.code, 'SELF_APPROVAL');
    assert.equal((await state()).version, 2);
    assert.equal((await records(history)).length, 2);
    assert.equal((await action('approve', 2, 'approver')).status, 200);
  });
  it('blocks direct writes, nested writes and JSON batch bypasses', async () => {
    await prepare();
    const event = (await records(history))[0]!;
    error(await request(casePath, 'buyer', 'PATCH', { status: 'Approved', totalCost: '0.00' }), 403);
    error(await request('Cases', 'buyer', 'POST', { ID: '50000000-0000-4000-8000-000000000099', caseNumber: 'BYPASS' }), 403);
    error(await request(`History(${event.ID})`, 'buyer', 'PATCH', { actor: 'approver' }), 405, 'ENTITY_IS_NOT_CRUD');
    error(await request(`${casePath}/history(${event.ID})`, 'buyer', 'PATCH', { actor: 'approver' }), 405, 'ENTITY_IS_NOT_CRUD');
    const batch = await request('$batch', 'buyer', 'POST', { requests: [{
      id: '1', method: 'PATCH', url: casePath,
      headers: { 'content-type': 'application/json' }, body: { status: 'Approved' }
    }] });
    assert.equal(batch.status, 200, JSON.stringify(batch.body));
    assert.equal(batch.body.responses[0].status, 403);
    assert.equal((await state()).status, 'Open');
    assert.equal((await state()).version, 1);
  });
  it('does not trust client-supplied totals or identities in action payloads', async () => {
    const response = await prepare('buyer', OFFER_A, { totalCost: '0.00', status: 'Approved', submittedBy: 'approver' });
    assert.ok([200, 400].includes(response.status), JSON.stringify(response.body));
    const saved = await state();
    assert.equal(saved.status, 'Open');
    if (response.status === 200) assert.equal(saved.totalCost, '2600.00');
    else assert.equal(saved.version, 0);
  });
  it('blocks mutation of submissions and further changes after approval', async () => {
    await submit();
    assert.equal((await action('approve', 2, 'approver')).status, 200);
    const snapshot = (await records(submissions))[0]!;
    error(await request(`Submissions(${snapshot.ID})`, 'approver', 'PATCH', { submittedBy: 'approver' }), 403);
    error(await request(`${casePath}/submissions(${snapshot.ID})`, 'approver', 'DELETE'), 403);
    for (const [name, user] of [['withdraw', 'buyer'], ['reopen', 'buyer'], ['decline', 'approver']] as const) {
      error(await action(name, 3, user, name === 'decline' ? { reason: 'Nachträglicher Versuch' } : {}), 409, 'INVALID_STATE');
    }
    assert.equal((await state()).version, 3);
    assert.equal((await records(history)).length, 3);
  });
});

describe('M1: atomicity and concurrent requests', () => {
  it('allows only one of two simultaneous approvals', async () => {
    await submit();
    const responses = await Promise.all([action('approve', 2, 'approver'), action('approve', 2, 'approver')]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    assert.equal((await records(history)).filter(row => row.event === 'Approved').length, 1);
    error(await action('approve', 2, 'approver'), 409, 'STALE_VERSION');
  });
  it('does not approve and withdraw the same revision concurrently', async () => {
    await submit();
    const responses = await Promise.all([action('approve', 2, 'approver'), action('withdraw', 2)]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    assert.equal((await state()).version, 3);
    assert.equal((await records(history)).length, 3);
  });
  it('prevents a stale selection from overwriting another selection', async () => {
    const responses = await Promise.all([prepare('buyer', OFFER_A), prepare('buyer', OFFER_B)]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    assert.equal((await state()).version, 1);
    assert.equal((await records(history)).length, 1);
  });
  it('rolls back case, submission and history when the final database write fails', async () => {
    await prepare();
    await cds.db.run(`CREATE TEMP TRIGGER fail_submission_history BEFORE INSERT ON procurement_History
      WHEN NEW.event = 'Submitted' BEGIN SELECT RAISE(ABORT, 'test: history unavailable'); END`);
    try { error(await action('submit', 1), 500); }
    finally { await cds.db.run('DROP TRIGGER fail_submission_history'); }
    const saved = await state();
    assert.equal(saved.status, 'Open');
    assert.equal(saved.version, 1);
    assert.equal(saved.submissionSequence, 0);
    assert.equal(saved.currentSubmission_ID, null);
    assert.equal((await records(submissions)).length, 0);
    assert.equal((await records(history)).length, 1);
    assert.equal((await action('submit', 1)).status, 200);
  });
});
