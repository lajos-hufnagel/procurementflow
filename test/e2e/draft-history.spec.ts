import { test, expect, auth, OFFER_A } from './fixtures.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

for (const publicDemo of [false, true]) {
  test.describe(`Draft history ${publicDemo ? 'public' : 'local'}`, () => {
    test.use({ publicDemo, throughAppRouter: true });
    for (const language of ['de', 'en']) {
      test(`${language}: a history read delivered after draft activation still succeeds`, async ({ page }, testInfo) => {
        const de = language === 'de';
        await page.goto('/decisions/webapp/index.html?sap-ui-language=' + language);
        await expect(page.getByText('PF-2026-001', { exact: true })).toBeVisible();
        let headers: Record<string, string> = auth();
        if (publicDemo) {
          const origin = new URL(page.url()).origin;
          const bootstrap = await page.request.post('/demo/session', { headers: { 'X-Demo-Bootstrap': '1', Origin: origin } });
          expect(bootstrap.status(), await bootstrap.text()).toBe(200);
          headers = { 'X-Demo-Role': 'buyer', 'X-Demo-CSRF': (await bootstrap.json()).csrfToken, Origin: origin };
        }
        const get = async (path: string) => {
          const response = await page.request.get('/procurement/' + path, { headers });
          expect(response.ok(), await response.text()).toBeTruthy();
          return response.json();
        };
        const id = (await get('Cases?$orderby=caseNumber&$top=1')).value[0].ID;
        const prepared = await page.request.post(`/procurement/Cases(${id})/ProcurementService.prepare`, {
          headers, data: { expectedVersion: 0, offerID: OFFER_A, reason: 'Initial decision', extraCostReason: 'Ensure supply' }
        });
        expect(prepared.status(), await prepared.text()).toBe(200);
        await page.goto(`/decisions/webapp/index.html?sap-ui-language=${language}#DecisionWorkspaces(ID=${id},IsActiveEntity=true)`);
        const history = page.getByRole('region', { name: de ? 'Verlauf' : 'History', exact: true });
        await history.scrollIntoViewIfNeeded();
        await expect(history.getByText(de ? 'Entscheidung gespeichert' : 'Decision saved', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: de ? 'Bearbeiten' : 'Edit', exact: true }).click();
        // Fiori restores focus after the draft navigation and rendering have completed.
        await expect(page.getByRole('textbox', { name: de ? 'Gewähltes Lieferangebot' : 'Selected offer', exact: true })).toBeFocused();
        await page.getByRole('textbox', { name: de ? 'Begründung der Entscheidung' : 'Decision explanation', exact: true }).fill('Saved while history was in flight');
        await page.keyboard.press('Tab');
        await expect.poll(async () => (await get(`DecisionWorkspaces(ID=${id},IsActiveEntity=false)`)).reason).toBe('Saved while history was in flight');
        await history.scrollIntoViewIfNeeded();

        const committed = deferred<void>();
        const reply = deferred<string>();
        let delayedRequest = '';
        let held = false;
        await page.route('**/procurement/$batch', async route => {
          const body = route.request().postData() || '';
          if (!held && /GET .*\/history\?[^\r\n]*\$search=buyer/.test(body)) {
            held = true;
            delayedRequest = body;
            await committed.promise;
            const response = await route.fetch();
            reply.resolve(await response.text());
            await route.fulfill({ response });
          } else if (body.includes('/ProcurementService.draftActivate')) {
            const response = await route.fetch();
            expect(await response.text()).not.toMatch(/HTTP\/1\.1 [45]\d\d/);
            await route.fulfill({ response });
            committed.resolve();
          } else {
            await route.continue();
          }
        });
        try {
          const search = history.getByRole('searchbox');
          await search.fill('buyer');
          await search.press('Enter');
          await expect(search).toHaveValue('buyer');
          await expect.poll(() => held, { message: 'The real history request is held until activation' }).toBe(true);
          await page.getByRole('button', { name: de ? 'Sichern' : 'Save', exact: true }).click();
          const delayedResponse = await reply.promise;
          await testInfo.attach('history-read-after-activation', { body: JSON.stringify({ request: delayedRequest, response: delayedResponse }, null, 2), contentType: 'application/json' });
          expect(delayedResponse, 'An in-flight read of saved business history must survive draft activation').not.toMatch(/HTTP\/1\.1 [45]\d\d/);
          await expect(page.getByRole('button', { name: de ? 'Einreichen' : 'Submit', exact: true })).toBeVisible();
          await expect(page.getByRole('alertdialog')).not.toBeVisible();
          const saved = await get(`Cases(${id})`);
          expect(saved).toMatchObject({ version: 2, status: 'Open', reason: 'Saved while history was in flight' });
          expect((await get(`Cases(${id})/history`)).value).toHaveLength(2);
          await history.scrollIntoViewIfNeeded();
          await search.fill('');
          await search.press('Enter');
          await expect(history.getByText(de ? 'Entscheidung gespeichert' : 'Decision saved', { exact: true })).toHaveCount(2);
          await page.getByRole('button', { name: de ? 'Einreichen' : 'Submit', exact: true }).click();
          await expect(page.getByRole('button', { name: de ? 'Zurücknehmen' : 'Withdraw', exact: true })).toBeVisible();
          await history.scrollIntoViewIfNeeded();
          await expect(history.getByText(de ? 'Eingereicht' : 'Submitted', { exact: true })).toBeVisible();
          expect((await get('Submissions')).value).toHaveLength(1);
          await expect(page.getByRole('alertdialog')).not.toBeVisible();
          await page.screenshot({ path: testInfo.outputPath('history-after-save-' + language + '.png'), animations: 'disabled' });
          // A change made through another interface must also be visible when the
          // cached Object Page is reopened from the list, without reloading the app.
          await page.evaluate(() => { location.hash = ''; });
          await expect(page.getByText('PF-2026-002', { exact: true })).toBeVisible();
          const withdrawn = await page.request.post(`/procurement/Cases(${id})/ProcurementService.withdraw`, {
            headers, data: { expectedVersion: 3 }
          });
          expect(withdrawn.status(), await withdrawn.text()).toBe(200);
          await page.getByText('PF-2026-001', { exact: true }).click();
          await history.scrollIntoViewIfNeeded();
          await expect(history.getByText(de ? 'Zurückgenommen' : 'Withdrawn', { exact: true })).toBeVisible();
          // Reuse the same Object Page for another case: an independent history binding
          // must not keep displaying the previous case's events.
          const next = (await get('Cases?$orderby=caseNumber&$skip=1&$top=1')).value[0];
          await page.goto(`/decisions/webapp/index.html?sap-ui-language=${language}#DecisionWorkspaces(ID=${next.ID},IsActiveEntity=true)`);
          await expect(page.getByRole('heading', { name: next.caseNumber, exact: true })).toBeVisible();
          await history.scrollIntoViewIfNeeded();
          await expect(history.getByText(de ? 'Eingereicht' : 'Submitted', { exact: true })).toHaveCount(0);
          await expect(history.getByText(de ? 'Entscheidung gespeichert' : 'Decision saved', { exact: true })).toHaveCount(0);
          await expect(page.getByRole('alertdialog')).not.toBeVisible();
        } finally {
          committed.resolve();
          await page.unroute('**/procurement/$batch');
        }
      });
    }
  });
}
