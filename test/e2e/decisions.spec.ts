import { test, expect, CASE, OFFER_A, OFFER_B, active, draft, auth } from './fixtures.ts';
import type { Page, APIRequestContext } from '@playwright/test';

async function openCase(page: Page) {
  await page.goto('/decisions/webapp/index.html');
  await page.getByText('PF-2026-001', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
}
async function chooseOffer(page: Page) {
  const field = page.getByRole('textbox', { name: 'Gewähltes Lieferangebot', exact: true });
  await field.focus();
  await page.keyboard.press('F4');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Tavrendo Controls', { exact: true })).toBeVisible();
  await expect(dialog.getByText('125,00', { exact: false }).first()).toBeVisible();
  // UI5 renders rows before the dialog's opening transition has completed.
  await expect(dialog).not.toHaveClass(/sapUiPopupInitial/);
  await dialog.getByText('Tavrendo Controls', { exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function draftInputs(page: Page) {
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await chooseOffer(page);
  await page.getByRole('textbox', { name: 'Begründung der Entscheidung', exact: true }).fill('Fertigungsauftrag termingerecht versorgen');
  await page.getByRole('textbox', { name: 'Mehrkostenbegründung', exact: true }).fill('600 Euro Mehrkosten vermeiden den Lieferengpass');
  await page.keyboard.press('Tab');
}
async function read(request: APIRequestContext, path = `Cases(${CASE})`, user = 'buyer') {
  const response = await request.get('/procurement/' + path, { headers: auth(user) });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function action(request: APIRequestContext, name: string, version: number, user = 'buyer', data = {}) {
  const response = await request.post(`/procurement/Cases(${CASE})/ProcurementService.${name}`, {
    headers: auth(user), data: { expectedVersion: version, ...data }
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test('Fiori: keyboard value help, resumed draft and four-eyes approval in the compiled app', async ({ page, request }, testInfo) => {
  await openCase(page);
  await draftInputs(page);
  await expect.poll(async () => (await read(request, draft)).extraCostReason).toBe('600 Euro Mehrkosten vermeiden den Lieferengpass');
  expect((await read(request)).version).toBe(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Begründung der Entscheidung', exact: true })).toHaveValue('Fertigungsauftrag termingerecht versorgen');
  await expect(page.getByRole('textbox', { name: 'Gewähltes Lieferangebot', exact: true })).toHaveValue('Tavrendo Controls');
  await page.getByRole('button', { name: 'Sichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Einreichen', exact: true })).toBeVisible();
  expect((await read(request)).totalCost).toBe('2600.00');
  await expect(page.getByText('600,00', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('fiori-decision-saved.png'), fullPage: true });
  await page.getByRole('button', { name: 'Einreichen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zurücknehmen', exact: true })).toBeVisible();
  expect((await read(request)).status).toBe('Submitted');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Freigeben', exact: true })).not.toBeVisible();
  await page.locator('#demo-user').selectOption('approver');
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await expect.poll(async () => (await read(request)).status).toBe('Approved');
  await expect(page.getByRole('button', { name: 'Freigeben', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('fiori-decision-approved.png'), fullPage: true });
  expect((await read(request, 'History')).value.map((row: any) => row.event).sort()).toEqual(['Approved', 'Prepared', 'Submitted']);
});

test('Fiori: English labels and self-approval visibility for both roles', async ({ page, request }) => {
  await action(request, 'prepare', 0, 'dual', { offerID: OFFER_A, reason: 'Terminsicherung', extraCostReason: 'Mehrkosten begründet' });
  await action(request, 'submit', 1, 'dual');
  await page.addInitScript(() => sessionStorage.setItem('procurementflow.demoUser', 'dual'));
  await page.goto('/decisions/webapp/index.html?sap-ui-language=en#' + active);
  await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).not.toBeVisible();
  await expect(page.getByText('Net total cost', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
  const denied = await request.post(`/procurement/Cases(${CASE})/ProcurementService.approve`, { headers: auth('dual'), data: { expectedVersion: 2 } });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe('SELF_APPROVAL');
});

test('Fiori: rejection requires an explanation and rework preserves history', async ({ page, request }) => {
  await action(request, 'prepare', 0, 'buyer', { offerID: OFFER_A, reason: 'Terminsicherung', extraCostReason: 'Mehrkosten begründet' });
  await action(request, 'submit', 1);
  await page.goto('/decisions/webapp/index.html#' + active);
  await page.locator('#demo-user').selectOption('approver');
  await page.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Entscheidung ablehnen', exact: true });
  await dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect((await read(request)).status).toBe('Submitted');
  await dialog.getByRole('textbox', { name: 'Begründung der Ablehnung', exact: true }).fill('Bitte die günstigere Alternative prüfen.');
  await dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect.poll(async () => (await read(request)).status).toBe('Rejected');
  await page.locator('#demo-user').selectOption('buyer');
  await page.getByRole('button', { name: 'Erneut bearbeiten', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  const history = (await read(request, 'History')).value;
  expect(history.find((row: any) => row.event === 'Rejected').reason).toBe('Bitte die günstigere Alternative prüfen.');
});

test('Fiori: stale draft shows a conflict and can be discarded without overwriting the case', async ({ page, request, browserErrors }) => {
  await openCase(page);
  await draftInputs(page);
  await expect.poll(async () => (await read(request, draft)).extraCostReason).toBe('600 Euro Mehrkosten vermeiden den Lieferengpass');
  await action(request, 'prepare', 0, 'dual', { offerID: OFFER_B, reason: 'Zwischenzeitlich günstiger entschieden' });
  await page.getByRole('button', { name: 'Sichern', exact: true }).click();
  await expect(page.getByText(/Der Fall wurde inzwischen geändert/).first()).toBeVisible();
  expect((await read(request)).selectedOffer_ID).toBe(OFFER_B);
  expect((await read(request, draft)).baseCaseVersion).toBe(0);
  const close = page.getByRole('button', { name: /^(Schließen|OK)$/ });
  if (await close.isVisible()) await close.click();
  await page.getByRole('button', { name: 'Entwurf verwerfen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Verwerfen$/ }).click();
  await expect.poll(async () => (await read(request, active)).HasDraftEntity).toBe(false);
  expect((await read(request)).selectedOffer_ID).toBe(OFFER_B);
  // UI5's standard Save handler also reports its already displayed 409 as a rejected promise.
  // Account for this expected negative-path error; unrelated browser errors still fail the fixture.
  const expectedError = browserErrors.findIndex(message => message.startsWith('Der Fall wurde inzwischen'));
  if (expectedError >= 0) browserErrors.splice(expectedError, 1);
});

test('Fiori: reader has no edit actions and the mobile layout stays within the viewport', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/decisions/webapp/index.html');
  await page.locator('#demo-user').selectOption('reader');
  await page.getByText('PF-2026-001', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
  for (const name of ['Bearbeiten', 'Einreichen', 'Freigeben', 'Ablehnen', 'Löschen']) {
    await expect(page.getByRole('button', { name, exact: true })).not.toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('fiori-reader-mobile.png'), fullPage: true });
  const denied = await request.post(`/procurement/${active}/ProcurementService.draftEdit`, { headers: auth('reader'), data: { PreserveChanges: true } });
  expect(denied.status()).toBe(403);
});

test('Fiori: switching identity during a saved draft opens the active case for the reader', async ({ page, request }) => {
  await openCase(page);
  await draftInputs(page);
  await page.locator('#demo-user').selectOption('reader');
  await expect(page.getByRole('heading', { name: 'PF-2026-001', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sichern', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).not.toBeVisible();
  expect((await read(request, draft)).extraCostReason).toBe('600 Euro Mehrkosten vermeiden den Lieferengpass');
  expect((await read(request)).version).toBe(0);
});

test('Fiori: an action uses the viewed version and does not retry a concurrent change', async ({ page, request }) => {
  await action(request, 'prepare', 0, 'buyer', { offerID: OFFER_A, reason: 'Terminsicherung', extraCostReason: 'Mehrkosten begründet' });
  const versionLoaded = page.waitForResponse(async response => response.url().endsWith('/$batch') && (await response.text()).includes('"version":1'));
  await page.goto('/decisions/webapp/index.html#' + active);
  await versionLoaded;
  await expect(page.getByRole('button', { name: 'Einreichen', exact: true })).toBeVisible();
  await action(request, 'prepare', 1, 'dual', { offerID: OFFER_B, reason: 'Andere Entscheidung' });
  await page.getByRole('button', { name: 'Einreichen', exact: true }).click();
  await expect(page.getByText(/Der Fall wurde inzwischen geändert/).first()).toBeVisible();
  const saved = await read(request);
  expect(saved.status).toBe('Open');
  expect(saved.version).toBe(2);
  expect(saved.selectedOffer_ID).toBe(OFFER_B);
  expect((await read(request, 'Submissions')).value).toHaveLength(0);
  await page.getByRole('button', { name: /^(Schließen|OK)$/ }).click();
  // Closing the backend message must not reveal a second dialog containing an object dump.
  await page.getByRole('link', { name: 'Cockpit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beschaffung im Blick', exact: true })).toBeVisible();
  await expect(page.getByText('[object Object]', { exact: true })).toHaveCount(0);
});

for (const language of ['de', 'en'] as const) {
  test(`Fiori: ${language} labels cover optional columns, column menus and switching language`, async ({ page, request }, testInfo) => {
    await action(request, 'prepare', 0, 'buyer', { offerID: OFFER_B, reason: 'Beschriftungen prüfen' });
    const de = language === 'de';
    const settingsName = de ? 'Einstellungen' : 'Settings';
    const dialogName = de ? 'Ansichtseinstellungen' : 'View Settings';
    const caseIDLabel = de ? 'Beschaffungsfall-ID' : 'Procurement case ID';
    await page.goto(`/decisions/webapp/index.html?sap-ui-language=${language}`);
    await expect(page.getByText('PF-2026-001', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: settingsName, exact: true }).click();
    const settings = page.getByRole('dialog', { name: dialogName, exact: true });
    await expect(settings.getByRole('gridcell', { name: caseIDLabel, exact: true })).toBeVisible();
    await expect(settings.getByText('procurementCase_ID', { exact: true })).toHaveCount(0);
    await expect(settings).not.toHaveClass(/sapUiPopupInitial/);
    await settings.getByRole('button', { name: de ? 'Abbrechen' : 'Cancel', exact: true }).click();
    await page.getByText('PF-2026-001', { exact: true }).click();
    const history = page.locator('.sapMListTbl[id*="procurementCase::history"]');
    await history.scrollIntoViewIfNeeded();
    await page.getByRole('region', { name: de ? 'Verlauf' : 'History', exact: true })
      .getByRole('button', { name: settingsName, exact: true }).click();
    const labels = de
      ? ['Ereignis', 'Bearbeitet von', 'Zeitpunkt', 'Begründung', 'Fallversion', 'Vorheriger Status', 'Neuer Status', 'Verlaufseintrag-ID', 'Beschaffungsfall-ID', 'Einreichungs-ID']
      : ['Event', 'Changed by', 'Time', 'Explanation', 'Case version', 'Previous status', 'New status', 'History entry ID', 'Procurement case ID', 'Submission ID'];
    for (const label of labels) await expect(settings.getByRole('gridcell', { name: label, exact: true })).toBeVisible();
    for (const raw of ['actor', 'caseVersion', 'fromStatus', 'toStatus', 'ID', 'procurementCase_ID', 'submission_ID']) {
      await expect(settings.getByText(raw, { exact: true })).toHaveCount(0);
    }
    // UI5 renders the dialog content before its opening transition enables interactions.
    await expect(settings).not.toHaveClass(/sapUiPopupInitial/);
    await settings.screenshot({ animations: 'disabled', path: testInfo.outputPath(`history-labels-${language}.png`) });
    const versionLabel = de ? 'Fallversion' : 'Case version';
    const versionRow = settings.getByRole('row').filter({ has: page.getByRole('gridcell', { name: versionLabel, exact: true }) });
    await versionRow.getByRole('checkbox').click();
    await expect(versionRow.getByRole('checkbox')).toBeChecked();
    await settings.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(settings).not.toBeVisible();
    // Sorted columns include a sort icon in their accessible header text.
    await history.getByRole('columnheader').filter({
      has: page.getByText(versionLabel, { exact: true })
    }).click();
    const menu = page.getByRole('dialog', { name: de ? 'Spalteneinstellungen' : 'Column Settings', exact: true });
    await expect(menu.getByText(versionLabel, { exact: true })).toHaveCount(2);
    await expect(menu.getByText('caseVersion', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    const nextLanguage = de ? 'en' : 'de';
    await page.locator('#language').selectOption(nextLanguage);
    await expect(page).toHaveURL(new RegExp(`sap-ui-language=${nextLanguage}`));
    await history.scrollIntoViewIfNeeded();
    await expect(history.getByRole('columnheader', { name: de ? 'Changed by' : 'Bearbeitet von', exact: true })).toBeVisible();
    await expect(page.locator('.pf-brand')).toHaveAttribute('aria-label', de ? 'ProcurementFlow home' : 'ProcurementFlow Start');
  });
}

for (const language of ['de', 'en'] as const) {
  test(`Fiori: ${language} missing explanations show one error and allow correction`, async ({ page, request }, testInfo) => {
    await action(request, 'prepare', 0, 'buyer', { offerID: OFFER_A, reason: '', extraCostReason: '' });
    const de = language === 'de';
    await page.goto(`/decisions/webapp/index.html?sap-ui-language=${language}#${active}`);
    const explanations = [
      { field: de ? 'Begründung der Entscheidung' : 'Decision explanation', value: 'Fertigungsauftrag absichern',
        error: de ? 'Bitte die Beschaffungsentscheidung begründen.' : 'Explain the procurement decision.' },
      { field: de ? 'Mehrkostenbegründung' : 'Extra cost explanation', value: '600 Euro sichern die rechtzeitige Versorgung',
        error: de ? 'Ab 500 Euro Mehrkosten ist eine zusätzliche Mehrkostenbegründung erforderlich.' : 'An additional explanation is required for extra costs of 500 euros or more.' }
    ];
    for (const [index, explanation] of explanations.entries()) {
      await page.getByRole('button', { name: de ? 'Einreichen' : 'Submit', exact: true }).click();
      await expect(page.getByText(explanation.error, { exact: true })).toBeVisible();
      expect((await read(request)).status).toBe('Open');
      expect((await read(request)).version).toBe(index + 1);
      await page.screenshot({ path: testInfo.outputPath(`validation-${language}-${index}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: /^(Schließen|Close|OK)$/ }).click();
      // A second object-error dialog would prevent editing after closing the useful validation message.
      await page.getByRole('button', { name: de ? 'Bearbeiten' : 'Edit', exact: true }).click();
      await expect(page.getByText('[object Object]', { exact: true })).toHaveCount(0);
      await page.getByRole('textbox', { name: explanation.field, exact: true }).fill(explanation.value);
      await page.keyboard.press('Tab');
      await page.getByRole('button', { name: de ? 'Sichern' : 'Save', exact: true }).click();
    }
    await page.getByRole('button', { name: de ? 'Einreichen' : 'Submit', exact: true }).click();
    await expect(page.getByRole('button', { name: de ? 'Zurücknehmen' : 'Withdraw', exact: true })).toBeVisible();
    expect((await read(request)).status).toBe('Submitted');
    expect((await read(request, 'Submissions')).value).toHaveLength(1);
    await expect(page.getByRole('alertdialog')).not.toBeVisible();
  });
}
