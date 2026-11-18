import { test as base, expect, CASE, OFFER_B, auth } from './fixtures.ts';
import type { Locator, Page } from '@playwright/test';

// A stale empty table must not conceal a failed OData search (including failures inside $batch).
const test = base.extend<{ searchResponses: void }>({
  searchResponses: [async ({ page }, use) => {
    const responses: Promise<string | undefined>[] = [];
    page.on('response', response => {
      if (!response.url().includes('/procurement/')) return;
      responses.push((async () => {
        const body = await response.text();
        if (response.status() >= 400 || /HTTP\/1\.1 [45]\d\d/.test(body)) return body;
      })());
    });
    await use();
    expect((await Promise.all(responses)).filter(Boolean), 'Failed OData search requests').toEqual([]);
  }, { auto: true }]
});
test.use({ throughAppRouter: true });

async function enterSearch(field: Locator, text: string) {
  await field.fill(text);
  await field.press('Enter');
}
async function searchData(field: Locator, text: string, entity: string) {
  await field.fill(text);
  const response = field.page().waitForResponse(result => {
    const request = result.request();
    const query = decodeURIComponent(request.postData() ?? request.url());
    return result.url().includes('/procurement/') && query.includes(entity) &&
      (text ? query.includes('$search=') : !query.includes('$search='));
  });
  await field.press('Enter');
  await (await response).finished();
}
async function closeSettings(page: Page, de: boolean) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: de ? 'Abbrechen' : 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

for (const language of ['de', 'en'] as const) {
  const de = language === 'de';
  test(`Search ${language}: cockpit works through the packaged AppRouter with words, case, symbols and clearing`, async ({ page }) => {
    await page.goto(`/cockpit/webapp/index.html?sap-ui-language=${language}`);
    const search = page.getByRole('searchbox', { name: de ? 'Fall oder Material suchen' : 'Search case or material' });
    await searchData(search, '  pf-2026-012  ', "Cases?");
    await expect(page.getByRole('row').filter({ hasText: 'PF-2026-012' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'PF-2026-001' })).toHaveCount(0);
    await searchData(search, 'motorregler 1049', "Cases?");
    await expect(page.getByRole('row').filter({ hasText: 'PF-2026-002' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'PF-2026-009' })).toHaveCount(0);
    await searchData(search, 'FÜR', "Cases?");
    await expect(page.getByRole('row').filter({ hasText: 'PF-2026-001' })).toBeVisible();
    for (const text of ['nichts-zu-finden', '%_', '&', '"']) {
      await searchData(search, text, "Cases?");
      await expect(page.getByText(de ? 'Keine passenden Beschaffungsfälle. Filter oder Suche ändern.' : 'No matching cases. Change the filter or search.', { exact: true })).toBeVisible();
      await expect(page.getByRole('alertdialog')).not.toBeVisible();
    }
    await searchData(search, '', "Cases?");
    await expect(page.getByRole('row').filter({ hasText: 'PF-2026-001' })).toBeVisible();
    await expect(page.locator('.pf-offer')).toHaveCount(3);
    await expect(page.locator('.sapMMsgStripError')).toHaveCount(0);
  });

  test(`Search ${language}: Fiori cases, history and offer value help find visible text through AppRouter`, async ({ page, request }, testInfo) => {
    for (const [index, name] of ['prepare', 'submit', 'withdraw'].entries()) {
      const response = await request.post(`/procurement/Cases(${CASE})/ProcurementService.${name}`, {
        headers: auth(), data: { expectedVersion: index, ...(name === 'prepare' ? { offerID: OFFER_B, reason: 'Montage sichern · Müller & Söhne' } : {}) }
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    await page.goto(`/decisions/webapp/index.html?sap-ui-language=${language}`);
    const listSearch = page.getByRole('searchbox');
    await searchData(listSearch, 'motorregler 1049', "DecisionWorkspaces?");
    await expect(page.getByText('PF-2026-002', { exact: true })).toBeVisible();
    await expect(page.getByText('PF-2026-009', { exact: true })).toHaveCount(0);
    await searchData(listSearch, 'norveltrik', "DecisionWorkspaces?");
    await expect(page.getByText('PF-2026-001', { exact: true })).toBeVisible();
    await expect(page.getByText('PF-2026-002', { exact: true })).toHaveCount(0);
    await searchData(listSearch, 'FÜR', "DecisionWorkspaces?");
    await expect(page.getByText('PF-2026-002', { exact: true })).toBeVisible();
    for (const text of ['nichtvorhanden', '%_', '&']) {
      await searchData(listSearch, text, "DecisionWorkspaces?");
      await expect(page.getByText('PF-2026-001', { exact: true })).toHaveCount(0);
    }
    // Fiori normalizes a lone quotation mark to an empty search.
    await enterSearch(listSearch, '"');
    await expect(page.getByText('PF-2026-002', { exact: true })).toBeVisible();
    await enterSearch(listSearch, '');
    await expect(page.getByText('PF-2026-002', { exact: true })).toBeVisible();
    // Native free-text case-number filter: wildcard syntax means "contains".
    const caseFilter = page.getByRole('textbox', { name: de ? 'Fallnummer' : 'Case number', exact: true });
    await caseFilter.fill('*001*'); await caseFilter.press('Enter');
    await page.getByRole('button', { name: de ? 'Start' : 'Go', exact: true }).click();
    await expect(page.getByText('PF-2026-002', { exact: true })).toHaveCount(0);
    await page.getByText('PF-2026-001', { exact: true }).click();
    const history = page.getByRole('region', { name: de ? 'Verlauf' : 'History', exact: true });
    await history.scrollIntoViewIfNeeded();
    const historySearch = history.getByRole('searchbox');
    await searchData(historySearch, de ? 'GESPEICHERT' : 'SAVED', "/history?");
    await expect(history.getByText(de ? 'Entscheidung gespeichert' : 'Decision saved', { exact: true })).toBeVisible();
    await expect(history.getByText(de ? 'Eingereicht' : 'Submitted', { exact: true })).toHaveCount(0);
    await searchData(historySearch, 'buyer', "/history?");
    await expect(history.getByText('buyer', { exact: true })).toHaveCount(3);
    for (const text of ['nichtvorhanden', '%_']) {
      await searchData(historySearch, text, "/history?");
      await expect(history.getByText('buyer', { exact: true })).toHaveCount(0);
    }
    await searchData(historySearch, 'MÜLLER & SÖHNE', "/history?");
    await expect(history.getByText('buyer', { exact: true })).toHaveCount(1);
    await expect(history.getByText(de ? 'Eingereicht' : 'Submitted', { exact: true })).toBeVisible();
    await searchData(historySearch, '', "/history?");
    await expect(history.getByText('buyer', { exact: true })).toHaveCount(3);
    await page.getByRole('button', { name: de ? 'Bearbeiten' : 'Edit', exact: true }).click();
    const offer = page.getByRole('textbox', { name: de ? 'Gewähltes Lieferangebot' : 'Selected offer', exact: true });
    await offer.focus(); await page.keyboard.press('F4');
    const dialog = page.getByRole('dialog');
    await expect(dialog).not.toHaveClass(/sapUiPopupInitial/);
    const offerSearch = dialog.getByRole('searchbox');
    await searchData(offerSearch, 'norveltrik komponenten', "Offers?");
    await expect(dialog.getByText('Norveltrik Komponenten', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Tavrendo Controls', { exact: true })).toHaveCount(0);
    for (const text of ['nichtvorhanden', '%_', '&']) {
      await searchData(offerSearch, text, "Offers?");
      await expect(dialog.getByText('Norveltrik Komponenten', { exact: true })).toHaveCount(0);
    }
    await searchData(offerSearch, '', "Offers?");
    await expect(dialog.getByText('Tavrendo Controls', { exact: true })).toBeVisible();
    const showFilters = dialog.getByRole('button', { name: de ? /Filter einblenden/ : /Show Filters/ });
    if (await showFilters.isVisible()) await showFilters.click();
    await expect(dialog.getByRole('textbox', { name: de ? 'Lieferant' : 'Supplier', exact: true })).toHaveCount(0);
    await dialog.screenshot({ path: testInfo.outputPath(`offer-search-${language}.png`), animations: 'disabled' });
    await searchData(offerSearch, 'tavrendo', "Offers?");
    await expect(dialog.getByRole('grid', { name: de ? 'Elemente (1)' : 'Items (1)', exact: true })).toBeVisible();
    await dialog.getByRole('gridcell', { name: 'Tavrendo Controls', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(offer).toHaveValue('Tavrendo Controls');
    // The editable offer field also has a free-text suggestion search.
    await offer.fill('norvel');
    const suggestion = page.getByText('Norveltrik Komponenten', { exact: true }).filter({ visible: true });
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(offer).toHaveValue('Norveltrik Komponenten');
  });

  test(`Search ${language}: column and filter selection search localized labels through AppRouter`, async ({ page }, testInfo) => {
    await page.goto(`/decisions/webapp/index.html?sap-ui-language=${language}`);
    await expect(page.getByText('PF-2026-001', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: de ? 'Einstellungen' : 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: de ? 'Ansichtseinstellungen' : 'View Settings', exact: true });
    await expect(settings).not.toHaveClass(/sapUiPopupInitial/);
    const columnSearch = settings.getByRole('searchbox');
    await enterSearch(columnSearch, de ? 'fallnummer' : 'case number');
    await expect(settings.getByRole('gridcell', { name: de ? 'Fallnummer' : 'Case number', exact: true })).toBeVisible();
    await expect(settings.getByRole('gridcell', { name: 'Status', exact: true })).toHaveCount(0);
    await enterSearch(columnSearch, 'nichtvorhanden');
    await expect(settings.getByRole('gridcell', { name: de ? 'Fallnummer' : 'Case number', exact: true })).toHaveCount(0);
    await enterSearch(columnSearch, '');
    await expect(settings.getByRole('gridcell', { name: 'Status', exact: true })).toBeVisible();
    await closeSettings(page, de);
    await page.getByRole('button', { name: de ? 'Filter anpassen' : 'Adapt Filters', exact: true }).click();
    const filters = page.getByRole('dialog');
    await expect(filters).not.toHaveClass(/sapUiPopupInitial/);
    await filters.screenshot({ path: testInfo.outputPath(`filter-search-${language}.png`), animations: 'disabled' });
    await enterSearch(filters.getByRole('searchbox'), de ? 'fallnummer' : 'case number');
    await expect(filters.getByText(de ? 'Fallnummer' : 'Case number', { exact: true }).first()).toBeVisible();
    await enterSearch(filters.getByRole('searchbox'), 'nichtvorhanden');
    await expect(filters.getByText(de ? 'Fallnummer' : 'Case number', { exact: true })).toHaveCount(0);
    await enterSearch(filters.getByRole('searchbox'), '');
    await expect(filters.getByText(de ? 'Fallnummer' : 'Case number', { exact: true }).first()).toBeVisible();
    await closeSettings(page, de);
    await page.getByText('PF-2026-001', { exact: true }).click();
    const history = page.getByRole('region', { name: de ? 'Verlauf' : 'History', exact: true });
    await history.scrollIntoViewIfNeeded();
    await history.getByRole('button', { name: de ? 'Einstellungen' : 'Settings', exact: true }).click();
    await expect(settings).not.toHaveClass(/sapUiPopupInitial/);
    await enterSearch(columnSearch, de ? 'vorheriger status' : 'previous status');
    await expect(settings.getByRole('gridcell', { name: de ? 'Vorheriger Status' : 'Previous status', exact: true })).toBeVisible();
    await expect(settings.getByRole('gridcell', { name: de ? 'Ereignis' : 'Event', exact: true })).toHaveCount(0);
    await enterSearch(columnSearch, 'nichtvorhanden');
    await expect(settings.getByRole('gridcell', { name: de ? 'Vorheriger Status' : 'Previous status', exact: true })).toHaveCount(0);
    await enterSearch(columnSearch, '');
    await expect(settings.getByRole('gridcell', { name: de ? 'Ereignis' : 'Event', exact: true })).toBeVisible();
    await closeSettings(page, de);
  });
}
