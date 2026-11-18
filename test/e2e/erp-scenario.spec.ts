import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';

test.use({ publicDemo: true, throughAppRouter: true, erpMode: 'available' });
async function api(page: Page, path: string, data?: Record<string, unknown>) {
  return page.evaluate(async ({ path, data }) => {
    const session = await (await fetch('/demo/session', { method: 'POST', headers: { 'X-Demo-Bootstrap': '1' } })).json();
    const response = await fetch('/procurement/' + path, { method: data ? 'POST' : 'GET', headers: {
      'X-Demo-Role': 'dual', 'X-Demo-CSRF': session.csrfToken, 'Content-Type': 'application/json'
    }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, data });
}
async function prepare(page: Page, id: string) {
  expect((await api(page, `Cases(${id})/ProcurementService.prepare`, {
    expectedVersion: 0, offerID: '40000000-0000-4000-8000-000000000002',
    reason: 'Demonstrate personal ERP recovery', extraCostReason: 'Ensure timely delivery'
  })).status).toBe(200);
}

for (const lang of ['de', 'en'] as const) {
  test(`ERP scenario ${lang}: private outage, preserved approval, recovery and reset`, async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(180000);
    const en = lang === 'en';
    await page.goto('/cockpit/webapp/index.html?sap-ui-language=' + lang);
    const select = page.getByRole('combobox', { name: en ? 'Demo scenario' : 'Demo-Szenario', exact: true });
    await expect(select).toHaveValue('normal');
    await select.selectOption('erp-outage');
    await expect(page.locator('#demo-scenario-note')).toBeVisible();
    await expect(select).toBeEnabled();
    await page.reload();
    await expect(select).toHaveValue('erp-outage');
    const id = (await api(page, 'Cases?$orderby=caseNumber&$top=1')).body.value[0].ID;
    await prepare(page, id);
    await page.goto(`/decisions/webapp/index.html?sap-ui-language=${lang}#DecisionWorkspaces(ID=${id},IsActiveEntity=true)`);
    await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
    await page.locator('#demo-user').selectOption('dual');
    await expect(select).toHaveValue('erp-outage');
    await page.getByRole('button', { name: en ? 'Submit' : 'Einreichen', exact: true }).click();
    await expect.poll(async () => (await api(page, `Cases(${id})`)).body.status).toBe('Submitted');
    await page.getByRole('button', { name: en ? 'Approve' : 'Freigeben', exact: true }).click();
    await expect.poll(async () => (await api(page, 'Transfers')).body.value[0]?.status, { timeout: 60000 }).toBe('Failed');
    const failed = (await api(page, 'Transfers')).body.value[0];
    expect(failed.lastErrorCode).toBe('ERP_DEMO_OUTAGE');
    expect((await api(page, `Cases(${id})`)).body).toMatchObject({ status: 'Approved', orderNumber: null });
    await page.getByRole('button', { name: en ? 'Refresh status' : 'Status aktualisieren', exact: true }).click();
    await page.getByRole('tab', { name: en ? 'ERP transfer' : 'ERP-Übertragung', exact: true }).click();
    const failure = page.getByText(en ? 'Demo simulation: ERP unavailable.' : 'Demo-Simulation: ERP nicht erreichbar.', { exact: true });
    await failure.scrollIntoViewIfNeeded();
    await expect(failure).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('erp-outage-' + lang + '.png'), animations: 'disabled' });

    const other = await browser.newContext({ baseURL });
    try {
      const otherPage = await other.newPage();
      await otherPage.goto('/cockpit/webapp/index.html?sap-ui-language=' + lang);
      await expect(otherPage.locator('#demo-scenario')).toBeVisible();
      await expect(otherPage.locator('#demo-scenario')).toHaveValue('normal');
      await expect(otherPage.locator('#demo-scenario-note')).toBeHidden();
      const otherID = (await api(otherPage, 'Cases?$orderby=caseNumber&$top=1')).body.value[0].ID;
      await prepare(otherPage, otherID);
      expect((await api(otherPage, `Cases(${otherID})/ProcurementService.submit`, { expectedVersion: 1 })).status).toBe(200);
      expect((await api(otherPage, `Cases(${otherID})/ProcurementService.approve`, { expectedVersion: 2 })).status).toBe(200);
      await expect.poll(async () => (await api(otherPage, `Cases(${otherID})`)).body.status, { timeout: 40000 }).toBe('Ordered');
      expect((await api(page, `Cases(${id})`)).body.status).toBe('Approved');

      await page.locator('#language').selectOption(en ? 'de' : 'en');
      await expect(page.locator('#demo-scenario')).toHaveValue('erp-outage');
      await expect(page.locator('#demo-scenario-message')).toHaveText(en
        ? 'Demo-Simulation: ERP nicht erreichbar. Nur Ihre Demo ist betroffen.'
        : 'Demo simulation: ERP unavailable. Only your demo is affected.');
      await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('tab', { name: en ? 'Beschaffungsentscheidung' : 'Procurement decision', exact: true }).click();
      const explanation = page.getByText('Demonstrate personal ERP recovery', { exact: true }).first();
      await explanation.scrollIntoViewIfNeeded();
      await expect(explanation).toBeInViewport();
      await expect(page.locator('#demo-scenario-stop')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: testInfo.outputPath('erp-outage-mobile-' + (en ? 'de' : 'en') + '.png'), animations: 'disabled' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('#demo-scenario-stop').click();
      await expect(page.locator('#demo-scenario-note')).toBeHidden();
      await page.getByRole('button', { name: en ? 'Übertragung wiederholen' : 'Retry transfer', exact: true }).click();
      await expect.poll(async () => (await api(page, `Cases(${id})`)).body.status, { timeout: 40000 }).toBe('Ordered');
      const ordered = (await api(page, `Cases(${id})`)).body;
      const transfers = (await api(page, 'Transfers')).body.value;
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({ ID: failed.ID, status: 'Succeeded', orderNumber: ordered.orderNumber });
      const attempts = (await api(page, 'TransferAttempts')).body.value;
      expect(attempts.filter((row: any) => row.outcome === 'Succeeded')).toHaveLength(1);
      expect(attempts.some((row: any) => row.errorCode === 'ERP_DEMO_OUTAGE')).toBe(true);
      await page.getByRole('button', { name: en ? 'Status aktualisieren' : 'Refresh status', exact: true }).click();
      await page.getByRole('tab', { name: en ? 'ERP-Übertragung' : 'ERP transfer', exact: true }).click();
      await expect(page.getByText(ordered.orderNumber, { exact: true })).toBeVisible();
      await page.locator('#demo-scenario').selectOption('erp-outage');
      await expect(page.locator('#demo-scenario-note')).toBeVisible();
      expect((await api(page, `Cases(${id})`)).body.orderNumber).toBe(ordered.orderNumber);
      await page.locator('#demo-reset').click();
      const confirmation = page.getByRole('alertdialog').filter({ has: page.getByRole('heading', { name: en ? 'Demo neu starten' : 'Restart demo', exact: true }) });
      await confirmation.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(page.locator('#demo-scenario')).toHaveValue('normal');
      await expect(page.locator('#demo-scenario-note')).toBeHidden();
      expect((await api(page, 'cockpitSummary()')).body.open).toBe(12);
      expect((await api(otherPage, `Cases(${otherID})`)).body.status).toBe('Ordered');
    } finally { await other.close(); }
  });
}

test('ERP scenario: failed save, other tabs, keyboard use and draft edits stay consistent', async ({ page, context }) => {
  test.setTimeout(120000);
  await page.goto('/cockpit/webapp/index.html?sap-ui-language=de');
  await expect(page.locator('#demo-scenario')).toHaveValue('normal');
  await page.route('**/demo/scenario', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
  await page.locator('#demo-scenario').selectOption('erp-outage');
  const error = page.getByRole('alertdialog').filter({ hasText: 'Das Demo-Szenario konnte nicht bestätigt werden.' });
  await expect(error).toBeVisible();
  await expect(page.locator('#demo-scenario')).toHaveValue('normal');
  await expect(page.locator('#demo-scenario-note')).toBeHidden();
  await error.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.unroute('**/demo/scenario');
  const second = await context.newPage();
  try {
    await second.goto('/decisions/webapp/index.html?sap-ui-language=de');
    await expect(second.locator('#demo-scenario')).toBeVisible();
    await expect(second.locator('#demo-scenario')).toHaveValue('normal');
    await page.bringToFront();
    await expect(page.locator('#demo-scenario')).toBeEnabled();
    await page.locator('#demo-scenario').focus();
    // Native Chromium selects support type-ahead in headless mode on macOS.
    await page.keyboard.press('e');
    await page.keyboard.press('Tab');
    await expect(page.locator('#demo-scenario-note')).toBeVisible();
    await expect(second.locator('#demo-scenario')).toHaveValue('erp-outage');
    await second.locator('#demo-scenario-stop').click();
    await expect(page.locator('#demo-scenario')).toHaveValue('normal');
    const id = (await api(page, 'Cases?$orderby=caseNumber&$top=1')).body.value[0].ID;
    await prepare(page, id);
    await page.goto(`/decisions/webapp/index.html?sap-ui-language=de#DecisionWorkspaces(ID=${id},IsActiveEntity=true)`);
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const reason = page.getByRole('textbox', { name: 'Begründung der Entscheidung', exact: true });
    await reason.fill('Entwurf bleibt beim Szenariowechsel erhalten');
    await page.locator('#demo-scenario').selectOption('erp-outage');
    await expect(page.locator('#demo-scenario-note')).toBeVisible();
    await expect(reason).toHaveValue('Entwurf bleibt beim Szenariowechsel erhalten');
    await page.getByRole('button', { name: 'Sichern', exact: true }).click();
    await expect(page.getByText('Entwurf bleibt beim Szenariowechsel erhalten', { exact: true })).toBeVisible();
    await page.locator('#demo-scenario-stop').click();
    await expect(page.locator('#demo-scenario-note')).toBeHidden();
  } finally { await second.close(); }
});
