import { test, expect, CASE, OFFER_A, active, auth } from './fixtures.ts';
import { erpAuth } from '../helpers/erp.ts';
import type { APIRequestContext } from '@playwright/test';

async function read(request: APIRequestContext, path = `Cases(${CASE})`) {
  const response = await request.get('/procurement/' + path, { headers: auth('reader') });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function submitted(request: APIRequestContext) {
  for (const [action, expectedVersion, data] of [
    ['prepare', 0, { offerID: OFFER_A, reason: 'Montage termingerecht versorgen', extraCostReason: '600 Euro sichern die Materialversorgung' }],
    ['submit', 1, {}]
  ] as const) {
    const response = await request.post(`/procurement/Cases(${CASE})/ProcurementService.${action}`, {
      headers: auth('dual'), data: { expectedVersion, ...data }
    });
    expect(response.status(), await response.text()).toBe(200);
  }
}

test.describe('M4 compiled services: outage and recovery', () => {
  test.use({ erpMode: 'unavailable' });
  test('Fiori preserves approval during outage and retry confirms one order in both UIs', async ({ page, request, erpEndpoint }, testInfo) => {
    await submitted(request);
    await page.addInitScript(() => sessionStorage.setItem('procurementflow.demoUser', 'approver'));
    await page.goto('/decisions/webapp/index.html#' + active);
    await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Status aktualisieren', exact: true })).toBeVisible();
    await expect.poll(async () => (await read(request, 'Transfers')).value[0]?.status).toBe('Failed');
    expect((await read(request)).status).toBe('Approved');
    const empty = await request.get(erpEndpoint + '/erp/Orders', { headers: erpAuth() });
    expect(await empty.json()).toEqual([]);
    await page.getByRole('button', { name: 'Status aktualisieren', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Übertragung wiederholen', exact: true })).toBeVisible();
    const error = page.getByText('ERP-Testdienst vorübergehend nicht verfügbar.', { exact: true });
    await error.scrollIntoViewIfNeeded();
    await expect(error).toBeVisible();
    await expect(page.getByText('Übertragung fehlgeschlagen', { exact: true })).toBeVisible();
    await expect(page.getByRole('grid', { name: /Verlauf/ }).getByText('Freigegeben', { exact: true })).toBeVisible();
    await expect(page.locator('.sapUiLocalBusyIndicator')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('transfer-failed.png'), animations: 'disabled' });
    const restored = await request.post(erpEndpoint + '/erp/simulate', { headers: erpAuth('erp-admin'), data: { mode: 'available' } });
    expect(restored.status()).toBe(200);
    await page.getByRole('button', { name: 'Übertragung wiederholen', exact: true }).click();
    await expect.poll(async () => (await read(request)).status).toBe('Ordered');
    await page.getByRole('button', { name: 'Status aktualisieren', exact: true }).click();
    const ordered = await read(request);
    await expect(page.getByText(ordered.orderNumber, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Übertragung wiederholen', exact: true })).not.toBeVisible();
    const response = await request.get(erpEndpoint + '/erp/Orders', { headers: erpAuth() });
    const orders = await response.json();
    expect(orders).toHaveLength(1);
    expect(orders[0].orderNumber).toBe(ordered.orderNumber);
    expect((await read(request, 'Transfers')).value[0].attemptCount).toBe(2);
    expect((await read(request, 'History')).value.filter((row: any) => row.event === 'Ordered')).toHaveLength(1);
    await page.getByRole('link', { name: 'Cockpit', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'PF-2026-001' }).getByText('Bestellt', { exact: true })).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'PF-2026-001' }).click();
    await expect(page.locator('.pf-transfer').getByText('Bestellung bestätigt', { exact: true })).toBeVisible();
    await expect(page.locator('.pf-transfer')).toContainText(ordered.orderNumber);
    await page.locator('.pf-transfer').scrollIntoViewIfNeeded();
    await page.locator('.pf-comparison').screenshot({ path: testInfo.outputPath('transfer-confirmed.png'), animations: 'disabled' });
  });
});

test.describe('M4 compiled services: lost acknowledgement', () => {
  test.use({ erpMode: 'drop-after-commit-once' });
  test('English reader cannot retry; approver recovers the existing ERP order', async ({ page, request, erpEndpoint }) => {
    await submitted(request);
    const approved = await request.post(`/procurement/Cases(${CASE})/ProcurementService.approve`, { headers: auth('approver'), data: { expectedVersion: 2 } });
    expect(approved.status()).toBe(200);
    await expect.poll(async () => (await read(request, 'Transfers')).value[0]?.status).toBe('Failed');
    const first = await request.get(erpEndpoint + '/erp/Orders', { headers: erpAuth() });
    const existing = await first.json(); expect(existing).toHaveLength(1);
    expect((await read(request)).status).toBe('Approved');
    await page.addInitScript(() => { if (!sessionStorage.getItem('procurementflow.demoUser')) sessionStorage.setItem('procurementflow.demoUser', 'reader'); });
    await page.goto('/decisions/webapp/index.html?sap-ui-language=en#' + active);
    await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry transfer', exact: true })).not.toBeVisible();
    const message = page.getByText('Connection to the ERP simulator interrupted.', { exact: true });
    await message.scrollIntoViewIfNeeded(); await expect(message).toBeVisible();
    const forbidden = await request.post(`/procurement/Cases(${CASE})/ProcurementService.retryTransfer`, { headers: auth('reader'), data: { expectedVersion: 3 } });
    expect(forbidden.status()).toBe(403);
    await page.locator('#demo-user').selectOption('approver');
    await page.getByRole('button', { name: 'Retry transfer', exact: true }).click();
    await expect.poll(async () => (await read(request)).status).toBe('Ordered');
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    const number = existing[0].orderNumber;
    const confirmed = page.getByText(number, { exact: true });
    await confirmed.scrollIntoViewIfNeeded(); await expect(confirmed).toBeVisible();
    const replayed = await request.get(erpEndpoint + '/erp/Orders', { headers: erpAuth() });
    expect(await replayed.json()).toEqual(existing);
  });
});
