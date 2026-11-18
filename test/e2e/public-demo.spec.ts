import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';

test.use({ publicDemo: true, throughAppRouter: true, erpMode: 'available' });

async function api(page: Page, path: string, role?: string, data?: Record<string, unknown>) {
  return page.evaluate(async ({ path, role, data }) => {
    const session = await (await fetch('/demo/session', { method: 'POST', headers: { 'X-Demo-Bootstrap': '1' } })).json();
    const response = await fetch('/procurement/' + path, { method: data ? 'POST' : 'GET', headers: {
      'X-Demo-Role': role ?? sessionStorage.getItem('procurementflow.demoUser') ?? 'buyer',
      'X-Demo-CSRF': session.csrfToken, 'Content-Type': 'application/json'
    }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, role, data });
}

for (const lang of ['de', 'en'] as const) {
  const en = lang === 'en';
  test(`Public demo ${lang}: no login, complete workflow, roles and private restart`, async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(150000);
    await page.goto('/cockpit/webapp/index.html?sap-ui-language=' + lang);
    await expect(page.locator('#demo-user')).toBeVisible();
    await expect(page.getByRole('heading', { name: en ? 'Procurement at a glance' : 'Beschaffung im Blick', exact: true })).toBeVisible();
    expect((await api(page, 'cockpitSummary()')).body).toMatchObject({ total: 12, open: 12, urgent: 4 });
    const id = (await api(page, 'Cases?$orderby=caseNumber&$top=1')).body.value[0].ID;

    const other = await browser.newContext({ baseURL, locale: en ? 'en-US' : 'de-DE' });
    const otherPage = await other.newPage();
    try {
      await otherPage.goto('/cockpit/webapp/index.html?sap-ui-language=' + lang);
      await expect(otherPage.locator('#demo-user')).toBeVisible();
      const otherID = (await api(otherPage, 'Cases?$orderby=caseNumber&$top=1')).body.value[0].ID;
      expect(otherID).not.toBe(id);
      expect((await api(otherPage, `Cases(${id})`)).status).toBe(404);

      const card = page.locator('.pf-offer').filter({ has: page.getByRole('heading', { name: 'Tavrendo Controls', exact: true }) });
      await card.getByRole('button', { name: en ? 'Choose offer' : 'Angebot auswählen', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: en ? 'Prepare procurement decision' : 'Beschaffungsentscheidung vorbereiten', exact: true });
      await dialog.getByRole('textbox', { name: en ? 'Decision explanation' : 'Entscheidungsbegründung', exact: true }).fill('Public demo: ensure timely production');
      await dialog.getByRole('textbox', { name: en ? 'Extra cost explanation' : 'Mehrkostenbegründung', exact: true }).fill('Accept 600 EUR for on-time delivery');
      await dialog.getByRole('button', { name: en ? 'Save and open decision' : 'Sichern und Entscheidung öffnen', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
      await page.getByRole('button', { name: en ? 'Edit' : 'Bearbeiten', exact: true }).click();
      const reason = page.getByRole('textbox', { name: en ? 'Decision explanation' : 'Begründung der Entscheidung', exact: true });
      await reason.fill('Public demo: reviewed draft');
      await page.getByRole('button', { name: en ? 'Save' : 'Sichern', exact: true }).click();
      await expect(page.getByText('Public demo: reviewed draft', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: en ? 'Submit' : 'Einreichen', exact: true }).click();
      await expect.poll(async () => (await api(page, `Cases(${id})`)).body.status).toBe('Submitted');
      await page.locator('#demo-user').selectOption('approver');
      await page.getByRole('button', { name: en ? 'Approve' : 'Freigeben', exact: true }).click();
      await expect.poll(async () => (await api(page, `Cases(${id})`)).body.status, { timeout: 40000 }).toBe('Ordered');
      const ordered = (await api(page, `Cases(${id})`)).body;
      expect(ordered.orderNumber).toMatch(/^SIM-[A-F0-9]{32}$/);
      expect((await api(page, 'Transfers')).body.value).toHaveLength(1);
      expect((await api(otherPage, `Cases(${otherID})`)).body).toMatchObject({ status: 'Open', version: 0, reason: null });
      expect((await api(otherPage, 'History')).body.value).toEqual([]);
      await page.getByRole('button', { name: en ? 'Refresh status' : 'Status aktualisieren', exact: true }).click();
      await expect(page.getByText(ordered.orderNumber, { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('public-order-' + lang + '.png'), fullPage: false });

      await page.locator('#demo-user').selectOption('reader');
      await expect(page.getByRole('button', { name: en ? 'Edit' : 'Bearbeiten', exact: true })).toHaveCount(0);
      await page.getByRole('link', { name: 'Cockpit', exact: true }).click();
      const search = page.getByRole('searchbox', { name: en ? 'Search case or material' : 'Fall oder Material suchen' });
      await search.fill('PF-2026-012'); await search.press('Enter');
      await expect(page.getByRole('row').filter({ hasText: 'PF-2026-012' })).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: 'PF-2026-001' })).toHaveCount(0);
      const tooltips = await page.locator('[title]').evaluateAll(nodes => nodes.map(node => node.getAttribute('title') ?? ''));
      expect(tooltips.filter(value => value.includes('·'))).toEqual([]);
      await page.locator('#demo-reset').click();
      const confirmation = page.getByRole('alertdialog').filter({ has: page.getByRole('heading', { name: en ? 'Restart demo' : 'Demo neu starten', exact: true }) });
      await confirmation.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: 'PF-2026-001' })).toBeVisible();
      await expect(page.locator('#demo-user')).toHaveValue('buyer');
      expect((await api(page, 'cockpitSummary()')).body).toMatchObject({ total: 12, open: 12, urgent: 4 });
      expect((await api(page, `Cases(${id})`)).status).toBe(404);
      expect((await api(otherPage, `Cases(${otherID})`)).body.version).toBe(0);
    } finally { await other.close(); }
  });
}

for (const lang of ['de', 'en'] as const) {
  const en = lang === 'en';
  test(`Public demo ${lang}: Dual submits and approves without changing identity, then receives one ERP order`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await page.goto('/?sap-ui-language=' + lang);
    await expect(page).toHaveURL(new RegExp('sap-ui-language=' + lang));
    await expect(page.getByRole('heading', { name: en ? 'Procurement at a glance' : 'Beschaffung im Blick', exact: true })).toBeVisible();
    await expect(page.locator('#demo-user')).toBeVisible();
    await page.locator('#demo-user').selectOption('dual');
    await expect(page.locator('#demo-user')).toHaveValue('dual');
    await expect(page.locator('#demo-user')).toHaveAttribute('title', en
      ? 'Demo exception: You can approve your own submissions.'
      : 'Demo-Ausnahme: Sie können Ihre eigenen Einreichungen freigeben.');
    const id = (await api(page, 'Cases?$orderby=caseNumber&$top=1')).body.value[0].ID;
    expect((await api(page, `Cases(${id})/ProcurementService.prepare`, 'dual', {
      expectedVersion: 0, offerID: '40000000-0000-4000-8000-000000000002',
      reason: 'Public Dual demo', extraCostReason: 'Timely delivery'
    })).status).toBe(200);
    await page.goto(`/decisions/webapp/index.html?sap-ui-language=${lang}#DecisionWorkspaces(ID=${id},IsActiveEntity=true)`);
    await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
    await expect(page.locator('#demo-user')).toHaveValue('dual');
    await page.getByRole('button', { name: en ? 'Submit' : 'Einreichen', exact: true }).click();
    await expect.poll(async () => (await api(page, `Cases(${id})`)).body.status).toBe('Submitted');
    await page.getByRole('button', { name: en ? 'Approve' : 'Freigeben', exact: true }).click();
    await expect.poll(async () => (await api(page, `Cases(${id})`)).body.status, { timeout: 40000 }).toBe('Ordered');
    const ordered = (await api(page, `Cases(${id})`)).body;
    expect(ordered.orderNumber).toMatch(/^SIM-[A-F0-9]{32}$/);
    expect((await api(page, 'Transfers')).body.value).toHaveLength(1);
    const events = (await api(page, `Cases(${id})/history`)).body.value;
    expect(events.find((event: any) => event.event === 'Submitted').actor).toBe('dual');
    expect(events.find((event: any) => event.event === 'Approved').actor).toBe('dual');
    await expect(page.locator('#demo-user')).toHaveValue('dual');
    await page.getByRole('button', { name: en ? 'Refresh status' : 'Status aktualisieren', exact: true }).click();
    await expect(page.getByText(ordered.orderNumber, { exact: true })).toBeVisible();
    await expect(page.getByText(en ? 'Ordered' : 'Bestellt', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('public-dual-' + lang + '.png'), animations: 'disabled' });
    await page.locator('#language').selectOption(en ? 'de' : 'en');
    await expect(page.locator('#demo-reset')).toHaveText(en ? 'Demo neu starten' : 'Restart demo');
    await expect(page.locator('#demo-user')).toHaveValue('dual');
    await expect(page.locator('#demo-user')).toHaveAttribute('title', en
      ? 'Demo-Ausnahme: Sie können Ihre eigenen Einreichungen freigeben.'
      : 'Demo exception: You can approve your own submissions.');
  });
}
