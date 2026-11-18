import { test, expect, CASE, OFFER_B, auth } from './fixtures.ts';
import type { Page } from '@playwright/test';

const cockpit = '/cockpit/webapp/index.html';

test('Cockpit: typed UI5 comparison saves into Fiori and reflects its four-eyes approval', async ({ page, request }, testInfo) => {
  await page.goto(cockpit + '#case/' + CASE);
  await expect(page.getByRole('heading', { name: 'Beschaffung im Blick', exact: true })).toBeVisible();
  await expect(page.locator('#scenario-label')).toBeHidden();
  const card = page.locator('.pf-offer').filter({ has: page.getByRole('heading', { name: 'Tavrendo Controls', exact: true }) });
  await expect(card.getByText('2.600,00', { exact: true })).toBeVisible();
  await expect(card.getByText('Deckt den Bedarfstermin', { exact: true })).toBeVisible();
  const firstRow = page.getByRole('row').filter({ hasText: 'PF-2026-001' });
  await expect(firstRow.getByText('23.11.2026', { exact: true })).toBeVisible();
  await expect(firstRow.getByText('30.11.2026', { exact: true })).toBeVisible();
  await expect(page.locator('.sapUiLocalBusyIndicator')).toHaveCount(0);
  await expect(firstRow).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('cockpit-overview.png'), animations: 'disabled' });
  await page.locator('.pf-comparison').scrollIntoViewIfNeeded();
  await page.locator('.pf-comparison').screenshot({ path: testInfo.outputPath('cockpit-comparison.png'), animations: 'disabled' });
  await page.locator('.pf-calendar').scrollIntoViewIfNeeded();
  await expect(page.locator('.pf-calendar .sapUiCalendarApp:visible')).toHaveCount(4);
  await page.locator('.pf-calendar').screenshot({ path: testInfo.outputPath('cockpit-schedule.png'), animations: 'disabled' });
  const choose = card.getByRole('button', { name: 'Angebot auswählen', exact: true });
  await choose.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Beschaffungsentscheidung vorbereiten', exact: true });
  await expect(dialog).not.toHaveClass(/sapUiPopupInitial/);
  await dialog.getByRole('textbox', { name: 'Entscheidungsbegründung', exact: true }).fill('Montageauftrag rechtzeitig versorgen');
  await dialog.getByRole('textbox', { name: 'Mehrkostenbegründung', exact: true }).fill('600 Euro für eine rechtzeitige Versorgung');
  await dialog.getByRole('button', { name: 'Sichern und Entscheidung öffnen', exact: true }).click();
  await expect(page).toHaveURL(/decisions.*IsActiveEntity=true/);
  await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
  await expect(page.getByText('Montageauftrag rechtzeitig versorgen', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Einreichen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zurücknehmen', exact: true })).toBeVisible();
  await page.locator('#demo-user').selectOption('approver');
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Freigeben', exact: true })).not.toBeVisible();
  await page.getByRole('link', { name: 'Cockpit', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'PF-2026-001' }).click();
  await expect(page.getByRole('heading', { name: 'Beschaffung im Blick', exact: true })).toBeVisible();
  await expect(page.getByText('Aktuell ausgewählt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Angebot auswählen', exact: true })).toHaveCount(0);
  const response = await request.get('/procurement/cockpitSummary()', { headers: auth('reader') });
  expect((await response.json()).approved).toBe(1);
  await expect(page.locator('.sapUiLocalBusyIndicator')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('cockpit-approved.png'), animations: 'disabled' });
});


test('Cockpit: server filters, paging, empty search and expired offers', async ({ page }) => {
  await page.goto(cockpit);
  await expect(page.getByRole('row').filter({ hasText: 'PF-2026-006' })).toBeVisible();
  await page.locator('.sapMGT').filter({ hasText: 'Zeitkritisch' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'PF-2026-012' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'PF-2026-001' })).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Fall oder Material suchen' });
  await search.fill('unbekanntesMaterial');
  await search.press('Enter');
  await expect(page.getByText('Keine passenden Beschaffungsfälle. Filter oder Suche ändern.', { exact: true })).toBeVisible();
  await search.fill('PF-2026-012');
  await search.press('Enter');
  await page.getByRole('row').filter({ hasText: 'PF-2026-012' }).click();
  await expect(page).toHaveURL(/#case\/50000000-0000-4000-8000-000000000012/);
  await expect(page.locator('.pf-comparison')).toBeInViewport();
  await expect(page.locator('.pf-offer').getByText('Am Bewertungsdatum abgelaufen', { exact: true })).toHaveCount(2);
  await expect(page.locator('.pf-offer button:enabled')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.pf-comparison').getByText('PF-2026-012', { exact: false })).toBeVisible();
});

test('Cockpit: stale selection stays blocked until an explicit reload', async ({ page, request }) => {
  await page.goto(cockpit + '#case/' + CASE);
  const card = page.locator('.pf-offer').filter({ has: page.getByRole('heading', { name: 'Tavrendo Controls', exact: true }) });
  await card.getByRole('button', { name: 'Angebot auswählen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Beschaffungsentscheidung vorbereiten', exact: true });
  await expect(dialog).not.toHaveClass(/sapUiPopupInitial/);
  await dialog.getByRole('textbox', { name: 'Entscheidungsbegründung', exact: true }).fill('Ältere Auswahl');
  await dialog.getByRole('textbox', { name: 'Mehrkostenbegründung', exact: true }).fill('Ältere Begründung');
  const changed = await request.post(`/procurement/Cases(${CASE})/ProcurementService.prepare`, { headers: auth(), data: { expectedVersion: 0, offerID: OFFER_B, reason: 'Neuere Auswahl', extraCostReason: '' } });
  expect(changed.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Sichern und Entscheidung öffnen', exact: true }).click();
  await expect(page.getByText('Der Fall wurde inzwischen geändert. Bitte neu laden und die Aktion erneut prüfen.', { exact: true })).toBeVisible();
  const after = await request.get(`/procurement/Cases(${CASE})`, { headers: auth() });
  const state = await after.json();
  expect(state.version).toBe(1);
  expect(state.selectedOffer_ID).toBe(OFFER_B);
  await page.getByRole('alertdialog').filter({ hasText: 'Der Fall wurde inzwischen geändert.' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  const selected = page.locator('.pf-offer').filter({ has: page.getByRole('heading', { name: 'Norveltrik Komponenten', exact: true }) });
  await expect(selected.getByText('Aktuell ausgewählt', { exact: true })).toBeVisible();
});

test('Cockpit: read failure is visible and Refresh recovers', async ({ page }) => {
  await page.route('**/procurement/cockpitSummary*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'DEMO_UNAVAILABLE', message: 'Kennzahlen vorübergehend nicht erreichbar.' } }) }));
  await page.goto(cockpit);
  await expect(page.getByText('Kennzahlen vorübergehend nicht erreichbar.', { exact: true })).toBeVisible();
  await page.unroute('**/procurement/cockpitSummary*');
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.getByText('Kennzahlen vorübergehend nicht erreichbar.', { exact: true })).not.toBeVisible();
  await expect(page.locator('.pf-offer')).toHaveCount(3);
});

test.describe('Cockpit: calendar days in another timezone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('English reader view stays responsive and keeps calendar dates unchanged', async ({ page }, testInfo) => {
    await page.addInitScript(() => sessionStorage.setItem('procurementflow.demoUser', 'reader'));
    await page.goto('/?sap-ui-language=en#case/' + CASE);
    await expect(page).toHaveURL(new RegExp('cockpit.*sap-ui-language=en#case/' + CASE + '$'));
    await expect(page.locator('.pf-brand')).toHaveAttribute('aria-label', 'ProcurementFlow home');
    await expect(page.getByRole('heading', { name: 'Procurement at a glance', exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'PF-2026-001' }).getByText('Nov 23, 2026', { exact: true })).toBeVisible();
    await expect(page.locator('.pf-offer').first().getByText('Nov 22, 2026', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose offer', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    // UI5 applies its responsive layout after the CSS breakpoint. Scrolling before
    // the DynamicPage finishes resizing targets positions from the desktop layout.
    await expect(page.locator('.pf-cockpit')).toHaveClass(/\bsapFDynamicPage-Std-Phone\b/);
    await page.locator('.pf-comparison').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const overflow = await page.locator('.sapFDynamicPageContentWrapper').evaluate(e => e.scrollWidth - e.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator('.pf-offer').first().scrollIntoViewIfNeeded();
    await expect(page.locator('.pf-offer').first()).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('cockpit-mobile-english.png'), animations: 'disabled' });
  });
});


function caseNumbers(page: Page) {
  return page.locator('[id$="--cases"]').getByText(/^PF-2026-\d{3}$/);
}
const numbers = (...ids: number[]) => ids.map(id => `PF-2026-${String(id).padStart(3, '0')}`);

async function sortCases(page: Page, field: string, descending = false, language = 'de') {
  await page.getByRole('button', { name: language === 'de' ? /^Sortieren:/ : /^Sort:/ }).click();
  const dialog = page.getByRole('dialog', { name: language === 'de' ? 'Beschaffungsfälle sortieren' : 'Sort procurement cases', exact: true });
  await expect(dialog).not.toHaveClass(/sapUiPopupInitial/);
  await dialog.getByText(field, { exact: true }).click();
  await dialog.getByText(language === 'de' ? (descending ? 'Absteigend' : 'Aufsteigend') : (descending ? 'Descending' : 'Ascending'), { exact: true }).click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('Cockpit: sorting covers all pages, survives filters and refresh, and Cancel preserves the order', async ({ page }) => {
  await page.goto(cockpit);
  await expect(caseNumbers(page)).toHaveText(numbers(1, 2, 3, 4, 5, 6));
  // The existing urgency default applies until an explicit sort choice is made.
  await page.locator('.sapMGT').filter({ hasText: 'Zeitkritisch' }).click();
  await expect(caseNumbers(page)).toHaveText(numbers(12, 2, 3, 4));
  await page.locator('.sapMGT').filter({ hasText: 'Offene Fälle' }).click();
  await expect(caseNumbers(page)).toHaveText(numbers(1, 2, 3, 4, 5, 6));
  await sortCases(page, 'Fallnummer', true);
  // Case 12 starts outside the first loaded page: sorting must happen on the server.
  await expect(caseNumbers(page)).toHaveText(numbers(12, 11, 10, 9, 8, 7));
  await page.getByRole('button', { name: /^Weitere/ }).click();
  await expect(caseNumbers(page)).toHaveText(numbers(12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1));
  await page.getByRole('button', { name: /^Sortieren:/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Beschaffungsfälle sortieren', exact: true });
  await expect(dialog).not.toHaveClass(/sapUiPopupInitial/);
  await expect(dialog.getByRole('listitem').filter({ hasText: /^Fallnummer$/ }).getByRole('radio')).toBeChecked();
  await expect(dialog.getByRole('listitem').filter({ hasText: /^Absteigend$/ }).getByRole('radio')).toBeChecked();
  await dialog.getByText('Material', { exact: true }).click();
  await dialog.getByText('Aufsteigend', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(caseNumbers(page)).toHaveText(numbers(12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1));
  const search = page.getByRole('searchbox', { name: 'Fall oder Material suchen' });
  await search.fill('Motorregler');
  await search.press('Enter');
  await expect(caseNumbers(page)).toHaveText(numbers(9, 2));
  await search.fill('');
  await search.press('Enter');
  await expect(caseNumbers(page).first()).toHaveText('PF-2026-012');
  await page.locator('.sapMGT').filter({ hasText: 'Zeitkritisch' }).click();
  await expect(caseNumbers(page)).toHaveText(numbers(12, 4, 3, 2));
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(caseNumbers(page)).toHaveText(numbers(12, 4, 3, 2));
  await expect(page.getByRole('button', { name: /^Sortieren:/ })).toHaveAttribute('title', 'Sortieren: Fallnummer (absteigend)');
});

test('Cockpit: dates use a stable tie-breaker and quantities sort numerically in both directions', async ({ page }) => {
  await page.goto(cockpit);
  await expect(caseNumbers(page)).toHaveCount(6);
  await sortCases(page, 'Benötigt am');
  await expect(caseNumbers(page)).toHaveText(numbers(12, 2, 3, 4, 1, 5));
  await sortCases(page, 'Benötigt am', true);
  await expect(caseNumbers(page)).toHaveText(numbers(11, 10, 9, 8, 7, 6));
  await page.getByRole('button', { name: /^Weitere/ }).click();
  await expect(caseNumbers(page)).toHaveText(numbers(11, 10, 9, 8, 7, 6, 1, 5, 4, 3, 2, 12));
  await sortCases(page, 'Menge');
  await expect(caseNumbers(page)).toHaveText(numbers(7, 3, 10, 2, 12, 9));
  await sortCases(page, 'Menge', true);
  await expect(caseNumbers(page)).toHaveText(numbers(8, 11, 5, 4, 6, 1));
});

test('Cockpit: status sorts by translated labels and a mobile reader can sort with the keyboard', async ({ page, request }, testInfo) => {
  const prepared = await request.post(`/procurement/Cases(${CASE})/ProcurementService.prepare`, {
    headers: auth(), data: { expectedVersion: 0, offerID: OFFER_B, reason: 'Statussortierung prüfen' }
  });
  expect(prepared.status(), await prepared.text()).toBe(200);
  const submitted = await request.post(`/procurement/Cases(${CASE})/ProcurementService.submit`, {
    headers: auth(), data: { expectedVersion: 1 }
  });
  expect(submitted.status(), await submitted.text()).toBe(200);
  await page.addInitScript(() => sessionStorage.setItem('procurementflow.demoUser', 'reader'));
  await page.goto(cockpit);
  await expect(caseNumbers(page)).toHaveCount(6);
  await sortCases(page, 'Status');
  // German: Eingereicht precedes Offen; English: Open precedes Submitted.
  await expect(caseNumbers(page)).toHaveText(numbers(1, 2, 3, 4, 5, 6));
  await page.goto(cockpit + '?sap-ui-language=en');
  await expect(caseNumbers(page)).toHaveCount(6);
  await sortCases(page, 'Status', false, 'en');
  await expect(caseNumbers(page)).toHaveText(numbers(2, 3, 4, 5, 6, 7));
  await sortCases(page, 'Status', true, 'en');
  await expect(caseNumbers(page)).toHaveText(numbers(1, 2, 3, 4, 5, 6));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.pf-cockpit')).toHaveClass(/\bsapFDynamicPage-Std-Phone\b/);
  const sortButton = page.getByRole('button', { name: /^Sort:/ });
  await sortButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Sort procurement cases', exact: true });
  await expect(dialog).not.toHaveClass(/sapUiPopupInitial/);
  const requiredOn = dialog.getByRole('listitem').filter({ hasText: /^Required on$/ });
  await requiredOn.focus();
  await page.keyboard.press('Space');
  await expect(requiredOn.getByRole('radio')).toBeChecked();
  const ascending = dialog.getByRole('listitem').filter({ hasText: /^Ascending$/ });
  await ascending.focus();
  await page.keyboard.press('Space');
  await expect(ascending.getByRole('radio')).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('cockpit-sorting-mobile-en.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'OK', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(caseNumbers(page)).toHaveText(numbers(12, 2, 3, 4, 1, 5));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.locator('.sapFDynamicPageContentWrapper').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
});


const defaultCaseRequest = (url: URL) => url.pathname === '/procurement/Cases'
  && ['caseNumber', 'caseNumber asc'].includes(url.searchParams.get('$orderby') ?? '') && url.searchParams.get('$top') === '1';

test('Cockpit: the lowest case number is the default independently of the loaded page, while explicit cases stay selected', async ({ page }) => {
  await page.goto('/');
  const comparison = page.locator('.pf-comparison');
  await expect(caseNumbers(page)).toHaveText(numbers(1, 2, 3, 4, 5, 6));
  await expect(comparison).toContainText('PF-2026-001');
  await page.getByRole('row').filter({ hasText: 'PF-2026-002' }).click();
  await expect(comparison).toContainText('PF-2026-002');
  await page.reload();
  await expect(comparison).toContainText('PF-2026-002');
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.locator('.sapUiLocalBusyIndicator')).toHaveCount(0);
  await expect(comparison).toContainText('PF-2026-002');
  await page.goto(cockpit + '#case/50000000-0000-4000-8000-000000000012');
  await expect(comparison).toContainText('PF-2026-012');
  await page.getByRole('link', { name: 'Cockpit', exact: true }).click();
  await expect(comparison).toContainText('PF-2026-001');
  await sortCases(page, 'Fallnummer', true);
  await expect(caseNumbers(page)).toHaveText(numbers(12, 11, 10, 9, 8, 7));
  await page.locator('.sapMGT').filter({ hasText: 'Zeitkritisch' }).click();
  await expect(caseNumbers(page)).toHaveText(numbers(12, 4, 3, 2));
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.locator('.sapUiLocalBusyIndicator')).toHaveCount(0);
  await expect(comparison).toContainText('PF-2026-001');
});

test('Cockpit: an empty or failed default-case lookup clears the comparison and Refresh recovers', async ({ page }) => {
  await page.goto(cockpit);
  const comparison = page.locator('.pf-comparison');
  await expect(comparison).toContainText('PF-2026-001');
  let fail = false;
  await page.route(defaultCaseRequest, route => route.fulfill({
    status: fail ? 503 : 200, contentType: 'application/json', headers: { 'OData-Version': '4.0' },
    body: JSON.stringify(fail ? { error: { code: 'DEMO_UNAVAILABLE', message: 'Beschaffungsfall vorübergehend nicht erreichbar.' } } : { value: [] })
  }));
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(comparison).not.toBeVisible();
  await expect(page.locator('.pf-calendar')).not.toBeVisible();
  await expect(page.locator('.sapMMsgStripError')).not.toBeVisible();
  await expect(page.locator('.sapUiLocalBusyIndicator')).toHaveCount(0);
  fail = true;
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.getByText('Beschaffungsfall vorübergehend nicht erreichbar.', { exact: true })).toBeVisible();
  await expect(comparison).not.toBeVisible();
  await page.unroute(defaultCaseRequest);
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(comparison).toContainText('PF-2026-001');
  await expect(page.locator('.sapMMsgStripError')).not.toBeVisible();
});

test('Cockpit: a delayed default lookup cannot overwrite an explicitly opened case', async ({ page }) => {
  const explicitCase = '50000000-0000-4000-8000-000000000002';
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(defaultCaseRequest, async route => { await pending; await route.continue(); });
  try {
    await page.goto(cockpit);
    await expect(caseNumbers(page)).toHaveCount(6);
    await page.evaluate(id => { location.hash = 'case/' + id; }, explicitCase);
    await expect(page.locator('.pf-comparison')).toContainText('PF-2026-002');
    release();
    await expect(page.locator('.sapUiLocalBusyIndicator')).toHaveCount(0);
    await expect(page.locator('.pf-comparison')).toContainText('PF-2026-002');
    await expect(page).toHaveURL(new RegExp('#case/' + explicitCase + '$'));
  } finally { release(); }
});

for (const language of ['de', 'en'] as const) {
  test(`Cockpit: ${language} malformed error text has a readable fallback and recovers`, async ({ page }) => {
    await page.route('**/procurement/cockpitSummary*', route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEMPORARY_FAILURE', message: '[object Object]' } })
    }));
    await page.goto(`${cockpit}?sap-ui-language=${language}`);
    const message = language === 'de' ? 'Die Daten konnten nicht geladen werden. Bitte erneut aktualisieren.' : 'The data could not be loaded. Please refresh again.';
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByText('[object Object]', { exact: true })).toHaveCount(0);
    await page.unroute('**/procurement/cockpitSummary*');
    await page.getByRole('button', { name: language === 'de' ? 'Aktualisieren' : 'Refresh', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).not.toBeVisible();
    await expect(page.locator('.pf-offer')).toHaveCount(3);
  });
}
