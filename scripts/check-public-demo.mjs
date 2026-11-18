import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = new URL(process.argv[2] ?? process.env.PUBLIC_DEMO_TEST_URL ?? '').origin;
assert.ok(origin.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
const report = { checkedAt: new Date().toISOString(), origin, checks: [] };
const record = (name, details = {}) => { report.checks.push({ name, ...details }); console.log('PASS ' + name); };
async function call(path, visitor, { method = 'GET', role = 'buyer', data, headers = {}, raw } = {}) {
  const response = await fetch(origin + path, { method, redirect: 'manual', signal: AbortSignal.timeout(30000), headers: {
    Origin: origin, 'Accept-Language': 'en', 'Content-Type': 'application/json', 'If-Match': '*',
    ...(visitor ? { Cookie: visitor.cookie, 'X-Demo-CSRF': visitor.csrf, 'X-Demo-Role': role } : {}), ...headers
  }, body: raw ?? (data === undefined ? undefined : JSON.stringify(data)) });
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  const cookie = response.headers.getSetCookie().find(value => /^(?:__Host-)?pf-demo=/.test(value));
  return { status: response.status, body, cookie: cookie?.split(';')[0], cookieAttributes: cookie?.split(';').slice(1).map(value => value.trim()) };
}
const read = (visitor, path) => call('/procurement/' + path, visitor, { role: 'reader' });
function ok(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; }
function blocked(result) { assert.ok([400, 401, 403, 404, 405].includes(result.status), `Request unexpectedly allowed: ${result.status}`); }
async function start() {
  const result = await call('/demo/session', undefined, { method: 'POST', headers: { 'X-Demo-Bootstrap': '1' } });
  const body = ok(result);
  assert.ok(result.cookie);
  assert.ok(result.cookieAttributes.includes('HttpOnly') && result.cookieAttributes.includes('SameSite=Strict'));
  if (origin.startsWith('https://')) {
    assert.ok(result.cookie.startsWith('__Host-pf-demo=')); assert.ok(result.cookieAttributes.includes('Secure'));
  }
  return { cookie: result.cookie, csrf: body.csrfToken };
}
const action = (visitor, id, name, version, role, extra = {}) => call(`/procurement/Cases(${id})/ProcurementService.${name}`, visitor,
  { method: 'POST', role, data: { expectedVersion: version, ...extra } });

try {
  assert.equal(ok(await call('/app-config')).publicDemo, true);
  assert.equal((await call('/procurement/Cases')).status, 401);
  const a = await start(), b = await start();
  record('Public bootstrap with protected session cookies; no SAP login');
  const aCases = ok(await read(a, 'Cases?$orderby=caseNumber')).value;
  const bCases = ok(await read(b, 'Cases?$orderby=caseNumber')).value;
  assert.equal(aCases.length, 12); assert.equal(bCases.length, 12);
  assert.ok(aCases.every(row => !bCases.some(other => other.ID === row.ID)));
  const item = aCases[0], second = bCases[0];
  for (const visitor of [a, b]) {
    const summary = ok(await read(visitor, 'cockpitSummary()'));
    assert.deepEqual([summary.total, summary.open, summary.urgent], [12, 12, 4]);
    for (const entity of ['Cases', 'DecisionWorkspaces']) {
      for (const [term, count] of [['PF-2026-012', 1], ['motorregler 1049', 1], ['&', 0]]) {
        assert.equal(ok(await read(visitor, entity + '?$search=' + encodeURIComponent(term))).value.length, count);
      }
    }
  }
  record('HANA summary, twelve isolated cases and scoped searches');
  blocked(await call('/procurement/Cases', a, { role: 'admin' }));
  blocked(await call('/demo/reset', { ...a, csrf: 'invalid' }, { method: 'POST', headers: { 'X-Demo-Bootstrap': '1' } }));
  blocked(await call('/demo/reset', a, { method: 'POST', headers: { Origin: 'https://example.invalid', 'X-Demo-Bootstrap': '1' } }));
  blocked(await action(a, item.ID, 'prepare', 0, 'reader', { offerID: item.referenceOffer_ID }));
  blocked(await action(b, item.ID, 'prepare', 0, 'buyer', { offerID: item.referenceOffer_ID }));
  record('Unknown roles, reader writes, foreign cases, invalid CSRF and foreign origins rejected');
  assert.equal(ok(await call('/demo/scenario', a)).scenario, 'normal');
  assert.equal((await call('/demo/scenario')).status, 401);
  blocked(await call('/demo/scenario', { ...a, csrf: 'invalid' }, { method: 'POST', data: { scenario: 'erp-outage' } }));
  blocked(await call('/demo/scenario', a, { method: 'POST', headers: { Origin: 'https://example.invalid' }, data: { scenario: 'erp-outage' } }));
  blocked(await call('/demo/scenario', a, { method: 'POST', data: { scenario: 'erp-outage', sessionID: second.demoScope } }));
  blocked(await call('/demo/scenario', a, { method: 'POST', data: { scenario: 'global' } }));
  assert.equal(ok(await call('/demo/scenario', a, { method: 'POST', data: { scenario: 'erp-outage' } })).scenario, 'erp-outage');
  assert.equal(ok(await call('/demo/scenario', b)).scenario, 'normal');
  assert.equal(ok(await call('/demo/scenario', a, { method: 'POST', data: { scenario: 'normal' } })).scenario, 'normal');
  record('Personal ERP scenario requires the owning session and CSRF, rejects foreign targeting and leaves another visitor unchanged');


  const active = `DecisionWorkspaces(ID=${item.ID},IsActiveEntity=true)`;
  const draft = `DecisionWorkspaces(ID=${item.ID},IsActiveEntity=false)`;
  ok(await call('/procurement/' + active + '/ProcurementService.draftEdit', a, { method: 'POST', role: 'dual', data: { PreserveChanges: true } }), 201);
  ok(await call('/procurement/' + draft, a, { method: 'PATCH', role: 'dual', data: {
    selectedOffer_ID: '40000000-0000-4000-8000-000000000002', reason: 'Private A verification', extraCostReason: 'Ensure timely production'
  } }));
  blocked(await call('/procurement/' + draft, b, { role: 'dual' }));
  blocked(await call('/procurement/' + draft, b, { method: 'PATCH', role: 'dual', data: { reason: 'Forbidden foreign change' } }));
  blocked(await call('/procurement/' + draft + '/DraftAdministrativeData', b, { role: 'dual' }));
  ok(await call('/procurement/' + draft + '/ProcurementService.draftActivate', a, { method: 'POST', role: 'dual', data: {} }));
  ok(await action(a, item.ID, 'submit', 1, 'dual'));
  assert.equal(ok(await call('/procurement/' + active, a, { role: 'dual' })).canApprove, true);
  blocked(await action(a, item.ID, 'approve', 2, 'buyer'));
  blocked(await action(b, item.ID, 'approve', 2, 'dual'));
  ok(await action(a, item.ID, 'approve', 2, 'dual'));
  const submission = ok(await read(a, 'Submissions')).value[0];
  const identity = ok(await call('/procurement/session()', a, { role: 'dual' })).userID;
  assert.equal(submission.submittedBy, identity);
  assert.equal(ok(await read(a, 'History')).value.find(row => row.event === 'Approved').actor, 'dual');
  record('Private drafts and explicit public Dual self-approval with the actual submitting identity');
  let ordered;
  for (let attempt = 0; attempt < 40; attempt++) {
    ordered = ok(await read(a, `Cases(${item.ID})`));
    if (ordered.status === 'Ordered') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(ordered.status, 'Ordered');
  assert.match(ordered.orderNumber, /^SIM-[A-F0-9]{32}$/);
  const transfer = ok(await read(a, 'Transfers')).value;
  assert.equal(transfer.length, 1); assert.equal(transfer[0].status, 'Succeeded');
  const attempts = ok(await read(a, 'TransferAttempts')).value;
  assert.equal(attempts.length, 1); assert.equal(attempts[0].outcome, 'Succeeded');
  record('Real cloud ERP order confirmed once through the OAuth destination', { orderNumber: ordered.orderNumber, transferID: transfer[0].ID });

  for (const entity of ['History', 'Submissions', 'Transfers', 'TransferAttempts']) {
    const rows = ok(await read(a, entity)).value;
    assert.ok(rows.length > 0);
    assert.deepEqual(ok(await read(b, entity)).value, []);
    blocked(await read(b, `${entity}(${rows[0].ID})`));
  }
  blocked(await read(b, `Cases(${item.ID})/history`));
  const boundary = 'public_demo_boundary';
  const batch = await call('/procurement/$batch', b, { method: 'POST', headers: { 'Content-Type': 'multipart/mixed; boundary=' + boundary }, raw:
    `--${boundary}\r\nContent-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\nGET Cases(${item.ID}) HTTP/1.1\r\nAccept: application/json\r\n\r\n\r\n--${boundary}--\r\n` });
  assert.equal(batch.status, 200); assert.match(batch.body.text, /HTTP\/1\.1 404/); assert.ok(!batch.body.text.includes('Private A verification'));
  record('Related data, navigation, direct IDs and OData batches remain private');

  ok(await action(b, second.ID, 'prepare', 0, 'buyer', { offerID: second.referenceOffer_ID, reason: 'Persistence verification' }));
  ok(await call('/demo/scenario', a, { method: 'POST', data: { scenario: 'erp-outage' } }));
  const reset = await call('/demo/reset', a, { method: 'POST', headers: { 'X-Demo-Bootstrap': '1' } });
  assert.equal(ok(reset).scenario, 'normal');
  const fresh = { cookie: reset.cookie, csrf: ok(reset).csrfToken };
  assert.equal((await read(a, 'Cases')).status, 401);
  assert.equal(ok(await read(fresh, 'cockpitSummary()')).open, 12);
  assert.equal(ok(await read(b, `Cases(${second.ID})`)).reason, 'Persistence verification');
  record('Personal restart revokes the old session and preserves another visitor');

  await mkdir('.local', { recursive: true });
  await writeFile('.local/public-demo-verification-session.json', JSON.stringify({ origin, visitor: b, caseID: second.ID,
    demoScope: second.demoScope, expiredScope: item.demoScope, expiredTransferID: transfer[0].ID, freshScope: ok(await read(fresh, 'Cases?$top=1')).value[0].demoScope }) + '\n', { mode: 0o600 });
  report.status = 'passed';
  await writeFile('.local/public-demo-cloud-api.json', JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Public demo verification failed');
  process.exitCode = 1;
}
