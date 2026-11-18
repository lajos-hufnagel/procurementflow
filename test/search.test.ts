import cds, { type Request } from '@sap/cds';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { applySearch } from '../srv/lib/search.ts';

const api = cds.test('serve', '--in-memory') as ReturnType<typeof cds.test> & { url: string };
const CASE = '50000000-0000-4000-8000-000000000001';
const OFFER = '40000000-0000-4000-8000-000000000003';
const workspace = `DecisionWorkspaces(ID=${CASE},IsActiveEntity=true)`;
const active = { $filter: 'IsActiveEntity eq true' };
async function request(path: string, query: Record<string, string> = {}, locale = 'de', user: string | null = 'reader', method = 'GET', data?: unknown, etag?: string) {
  const search = Object.entries(query).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  const headers: Record<string, string> = { 'Accept-Language': locale, 'Content-Type': 'application/json' };
  if (user) headers.Authorization = 'Basic ' + Buffer.from(`${user}:demo-${user}`).toString('base64');
  if (etag) headers['If-Match'] = etag;
  const response = await fetch(api.url + '/procurement/' + path + (search ? '?' + search : ''), {
    method, headers, body: data ? JSON.stringify(data) : undefined
  });
  const raw = await response.text();
  let body: Record<string, any>;
  try { body = JSON.parse(raw); } catch { body = { text: raw }; }
  return { status: response.status, body };
}
async function search(entity: string, term: string, extra = {}, locale = 'de') {
  const result = await request(entity, { $search: term, ...extra }, locale);
  assert.equal(result.status, 200, `${entity}: ${term}: ${JSON.stringify(result.body)}`);
  return result.body;
}
async function prepare() {
  const result = await request(`Cases(${CASE})/ProcurementService.prepare`, {}, 'de', 'buyer', 'POST', {
    expectedVersion: 0, offerID: OFFER, reason: 'Fertigung absichern'
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
}
beforeEach(async () => { await api.data.reset(); });

describe('Search across both applications', () => {
  it('finds case numbers, material codes, multiple words and German upper-case text in both case lists', async () => {
    for (const entity of ['Cases', 'DecisionWorkspaces']) {
      const extra = entity === 'DecisionWorkspaces' ? active : {};
      assert.equal((await search(entity, 'pf-2026-001', extra)).value[0].ID, CASE);
      assert.equal((await search(entity, 'wm-240', extra)).value[0].ID, CASE);
      assert.equal((await search(entity, 'motorregler 1049', extra)).value.length, 1);
      assert.equal((await search(entity, 'FÜR', extra)).value.length, 12);
      assert.ok((await search(entity, 'karlsruhe', extra)).value.some((row: { ID: string }) => row.ID === CASE));
      assert.equal((await search(entity, 'nichtvorhanden', extra)).value.length, 0);
    }
  });
  it('searches optional suppliers without dropping cases that have no selected offer', async () => {
    assert.equal((await search('DecisionWorkspaces', 'PF-2026', active)).value.length, 12);
    await prepare();
    assert.equal((await search('DecisionWorkspaces', 'norveltrik', active)).value[0].ID, CASE);
    assert.equal((await search('Offers', 'norveltrik wm-240')).value[0].ID, OFFER);
    assert.equal((await search('Offers', 'norveltrik nichtvorhanden')).value.length, 0);
  });
  it('finds visible event and status descriptions in the requested language', async () => {
    await prepare();
    assert.equal((await search(`Cases(${CASE})/history`, 'entscheidung gespeichert')).value.length, 1);
    assert.equal((await search(`Cases(${CASE})/history`, 'decision saved', {}, 'en')).value.length, 1);
    assert.equal((await search(`Cases(${CASE})/history`, 'buyer')).value.length, 1);
    assert.equal((await search('Cases', 'offen')).value.length, 12);
    assert.equal((await search('Cases', 'open', {}, 'en')).value.length, 12);
    assert.equal((await search('History', 'entscheidung gespeichert', {}, 'en')).value.length, 0);
  });
  it('keeps special characters literal and preserves the case boundary of history searches', async () => {
    const common = { event: 'Prepared', fromStatus: 'Open', toStatus: 'Open', actor: 'buyer', occurredAt: '2026-11-16T12:00:00Z', caseVersion: 99 };
    await cds.db.run(cds.ql.INSERT.into('procurement.History').entries([
      { ...common, ID: '60000000-0000-4000-8000-000000000091', procurementCase_ID: CASE, reason: 'Müller & Söhne + 100%_Sonderpreis O\'Reilly "A" Straße' },
      { ...common, ID: '60000000-0000-4000-8000-000000000092', procurementCase_ID: '50000000-0000-4000-8000-000000000002', reason: 'Anderer Fall 100%_Sonderpreis' }
    ]));
    for (const term of ['MÜLLER', 'SÖHNE', '100%_', "O'Reilly", '"\\"A\\""', 'STRASSE', '"&"', '"+"', '&', 'Müller & Söhne']) {
      assert.equal((await search(`Cases(${CASE})/history`, term)).value.length, 1, term);
    }
    assert.equal((await search(`Cases(${CASE})/history`, 'anderer')).value.length, 0);
    assert.equal((await search('Cases', '%')).value.length, 0);
    assert.equal((await search('Cases', '_')).value.length, 0);
    assert.equal((await search('Cases', "' OR 1=1 --")).value.length, 0);
  });
  it('supports phrases and boolean search without ignoring later terms', async () => {
    for (const [term, count] of [['"Motorregler MC-410"', 2], ['Motorregler AND 1049', 1],
      ['Motorregler OR Netzteil', 4], ['Motorregler NOT 1049', 1], ['NOT Motorregler', 10],
      ['(Motorregler OR Netzteil) AND 1049', 1], ['Motorregler nichtvorhanden', 0]] as const) {
      assert.equal((await search('Cases', term)).value.length, count, term);
    }
  });
  it('combines search, status filters, counting, sorting and paging on the server', async () => {
    const result = await search('DecisionWorkspaces', 'motorregler', {
      $filter: "IsActiveEntity eq true and procurementCase/status eq 'Open'", $count: 'true',
      $orderby: 'procurementCase/caseNumber asc', $skip: '1', $top: '1', $expand: 'procurementCase'
    });
    assert.equal(result['@odata.count'], 2);
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0].procurementCase.caseNumber, 'PF-2026-009');
    assert.equal((await search('Cases', 'motorregler', { $filter: "status eq 'Approved'" })).value.length, 0);
  });
  it('searches the current draft and keeps drafts private to their owner', async () => {
    const row = await request(workspace, {}, 'de', 'buyer');
    const created = await request(workspace + '/ProcurementService.draftEdit', {}, 'de', 'buyer', 'POST', { PreserveChanges: true }, row.body['@odata.etag']);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const draft = `DecisionWorkspaces(ID=${CASE},IsActiveEntity=false)`;
    const changed = await request(draft, {}, 'de', 'buyer', 'PATCH', { selectedOffer_ID: OFFER }, created.body['@odata.etag']);
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const mine = await request('DecisionWorkspaces', { $filter: 'IsActiveEntity eq false', $search: 'norveltrik' }, 'de', 'buyer');
    assert.equal(mine.body.value.length, 1);
    const other = await request('DecisionWorkspaces', { $filter: 'IsActiveEntity eq false', $search: 'norveltrik' }, 'de', 'reader');
    assert.equal(other.body.value.length, 0);
    assert.equal((await search('DecisionWorkspaces', 'norveltrik', active)).value.length, 0);
  });
  it('preserves authentication and allows all three read roles to search', async () => {
    assert.equal((await request('Cases', { $search: 'PF-2026' }, 'de', null)).status, 401);
    for (const user of ['buyer', 'approver', 'reader']) {
      const result = await request('Cases', { $search: 'PF-2026-001' }, 'de', user);
      assert.equal(result.status, 200);
      assert.equal(result.body.value.length, 1);
    }
  });
  it('renders the real HANA SQL with bound parameters and no fuzzy or wildcard search', async () => {
    const HANAService = createRequire(import.meta.url)('@cap-js/hana');
    const hana = new HANAService('search-sql-check', cds.model, { kind: 'hana', credentials: { host: 'not-connected.invalid', port: 443, user: 'sql-render-only', password: 'not-used' } });
    hana.server = { major: 4 };
    for (const entity of ['Cases', 'DecisionWorkspaces', 'History', 'Offers']) {
      const target = cds.services.ProcurementService!.entities[entity]!;
      const query = cds.ql.SELECT.from(target).columns('ID');
      query.SELECT.search = [{ val: '"100%_ O\'Reilly"' }];
      applySearch({ query, target } as unknown as Request);
      const result = hana.cqn2sql(query);
      assert.match(result.sql, /locate\(/i);
      assert.doesNotMatch(result.sql, /FUZZY|\blike\b|O'Reilly|100%_/i);
      assert.ok(result.values.includes("100%_ o'reilly"), entity);
      assert.equal(query.SELECT.search, undefined);
    }
  });
});
