import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

interface ErrorMessages {
  text(error: unknown, fallback?: string): string;
  isReportedActionError(error: unknown): boolean;
}
async function moduleFromSource(path: string, dependencies: Record<string, unknown>): Promise<any> {
  let exported: unknown;
  runInNewContext(await readFile(path, 'utf8'), {
    sap: { ui: { define: (names: string[], factory: (...values: unknown[]) => unknown) => {
      exported = factory(...names.map(name => dependencies[name]));
    } } }
  }, { filename: path });
  assert.ok(exported);
  return exported;
}
async function messages(locale = 'de'): Promise<ErrorMessages> {
  return moduleFromSource('app/shared/ErrorMessage.js', { 'sap/base/i18n/Localization': { getLanguage: () => locale } });
}

// Exercise the real UI modules at their UI5 boundary, without a browser or backend mock replacing their logic.
async function actions(options: { actionError?: unknown; refreshError?: unknown; loadError?: unknown; refreshGate?: Promise<void>; onRefresh?: () => void; refreshVersion?: number } = {}) {
  const shown: string[] = [], notifications: string[] = [];
  const calls = { action: 0, refresh: 0, read: 0 };
  let version = 7;
  const versions: number[] = [];
  const model = { bindContext: () => binding };
  const context = { getModel: () => model, requestProperty: async (name: string) => name === 'ID' ? 'case-1' : true };
  const binding = {
    destroy() {}, getBoundContext: () => ({ requestRefresh: async () => {} }),
    requestObject: async () => { calls.read++; if ('loadError' in options) throw options.loadError; return { version }; }
  };
  const texts: Record<string, string> = {
    actionFailed: 'Aktion fehlgeschlagen. Bitte den Stand prüfen.', loadFailed: 'Laden fehlgeschlagen.',
    actionRefreshFailed: 'Die Aktion wurde ausgeführt, aber der aktuelle Stand konnte nicht geladen werden.'
  };
  const ui = await moduleFromSource('app/decisions/webapp/ext/Actions.js', {
    'procurementflow/shared/ErrorMessage': await messages(),
    'sap/m/MessageBox': { error: (text: string) => shown.push(text) },
    'sap/m/MessageToast': { show: (text: string) => notifications.push(text) },
    'sap/ui/core/library': { MessageType: { Information: 'Information' } }
  });
  await ui.bind(context, {
    showMessages() {},
    getEditFlow: () => ({ invokeAction: async (_name: string, parameters: any) => {
      calls.action++;
      versions.push(parameters.parameterValues[0].value);
      assert.equal(parameters.parameterValues[0].value, version);
      if ('actionError' in options) throw options.actionError;
    } }),
    refresh: async () => {
      calls.refresh++; options.onRefresh?.();
      if (options.refreshError) throw options.refreshError;
      await options.refreshGate;
      if (options.refreshVersion !== undefined) version = options.refreshVersion;
    }
  }, { getResourceBundle: async () => ({ getText: (key: string) => texts[key] ?? key }) });
  return { ui, context, shown, notifications, calls, versions };
}

describe('Readable UI errors', () => {
  it('extracts native, OData and nested rejection messages without coercing objects', async () => {
    const ui = await messages();
    const text = 'Bitte die Beschaffungsentscheidung begründen.';
    for (const error of [new Error(text), text, { message: text }, { error: { message: text } },
      { message: { value: text } }, { responseText: JSON.stringify({ error: { message: text } }) },
      [{ status: 'rejected', reason: { error: { message: text } } }]]) {
      assert.equal(ui.text(error, 'Fallback'), text);
    }
    assert.equal(ui.text([{ status: 'fulfilled', value: { message: 'Not an error' } },
      { status: 'rejected', reason: new Error(text) }, { status: 'rejected', reason: new Error(text) }]), text);
  });
  it('falls back for empty, malformed and cyclic errors', async () => {
    const ui = await messages();
    const cyclic: Record<string, unknown> = {}; cyclic.cause = cyclic;
    for (const error of [undefined, null, {}, [], cyclic, { message: {} }, { message: '[object Object]' },
      new Error('[object Object]'), 'undefined', { responseText: '<html>502 Bad Gateway</html>' }]) {
      assert.equal(ui.text(error, 'Bitte erneut laden.'), 'Bitte erneut laden.');
    }
  });
  it('provides a readable fallback in German and English before app resources are ready', async () => {
    assert.match((await messages('de-DE')).text({}), /^Die Aktion konnte nicht abgeschlossen werden\./);
    assert.match((await messages('en-US')).text({}), /^The action could not be completed\./);
  });
  it('identifies only the rejected action results already handled by EditFlow', async () => {
    const ui = await messages();
    assert.equal(ui.isReportedActionError([{ status: 'rejected', reason: new Error('Backend') }]), true);
    for (const error of [null, new Error('Unexpected'), {}, [], [{ message: 'Unknown wrapper' }], [{ status: 'fulfilled' }]]) {
      assert.equal(ui.isReportedActionError(error), false);
    }
  });
});

describe('Fiori action error handling', () => {
  it('does not display or retry a backend rejection after EditFlow has shown it', async () => {
    const app = await actions({ actionError: [{ status: 'rejected', reason: new Error('Begründung fehlt.') }] });
    await app.ui.submit(app.context);
    assert.deepEqual(app.shown, []);
    assert.deepEqual(app.notifications, []);
    assert.deepEqual(app.calls, { action: 1, refresh: 0, read: 1 });
  });
  it('still displays an unexpected action failure with a translated fallback', async () => {
    const app = await actions({ actionError: { message: {} } });
    await app.ui.approve(app.context);
    assert.deepEqual(app.shown, ['Aktion fehlgeschlagen. Bitte den Stand prüfen.']);
    assert.equal(app.calls.action, 1);
    assert.equal(app.calls.refresh, 0);
  });
  it('distinguishes a successful write from a failed refresh without repeating the action', async () => {
    const app = await actions({ refreshError: { error: { message: 'Verbindung unterbrochen.' } } });
    await app.ui.submit(app.context);
    assert.equal(app.shown.length, 1);
    assert.match(app.shown[0]!, /^Die Aktion wurde ausgeführt/);
    assert.match(app.shown[0]!, /Verbindung unterbrochen\./);
    assert.equal(app.calls.action, 1);
    assert.deepEqual(app.notifications, []);
  });
  it('reports structured initial-load failures and does not invoke an action with an unknown version', async () => {
    for (const error of [{ message: { value: 'Der Fall konnte nicht geladen werden.' } }, null, undefined]) {
      const app = await actions({ loadError: error });
      await app.ui.submit(app.context);
      assert.deepEqual(app.shown, [error ? 'Der Fall konnte nicht geladen werden.' : 'Laden fehlgeschlagen.']);
      assert.equal(app.calls.action, 0);
    }
  });
});

describe('Fiori action sequencing', () => {
  it('waits for the submitted decision and its viewed version to refresh before a fast approval', async () => {
    let resume!: () => void, announced!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const refreshing = new Promise<void>(resolve => { announced = resolve; });
    const app = await actions({ refreshGate: gate, onRefresh: announced, refreshVersion: 8 });
    const submitted = app.ui.submit(app.context);
    await refreshing;
    const approved = app.ui.approve(app.context);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(app.calls.action, 1, 'Approval must not use the previous version while Submit is still refreshing');
    resume();
    await Promise.all([submitted, approved]);
    assert.deepEqual(app.versions, [7, 8]);
    assert.equal(app.calls.action, 2);
    assert.deepEqual(app.shown, []);
  });
  it('serializes an explicit refresh with an ongoing action without repeating the write', async () => {
    let resume!: () => void, announced!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const refreshing = new Promise<void>(resolve => { announced = resolve; });
    const app = await actions({ refreshGate: gate, onRefresh: announced, refreshVersion: 8 });
    const submitted = app.ui.submit(app.context);
    await refreshing;
    const refreshed = app.ui.refresh(app.context);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(app.calls.refresh, 1);
    resume();
    await Promise.all([submitted, refreshed]);
    assert.equal(app.calls.action, 1);
    assert.equal(app.calls.refresh, 2);
    assert.deepEqual(app.shown, []);
  });
});
