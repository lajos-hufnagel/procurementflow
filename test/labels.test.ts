import cds from '@sap/cds';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const bundles = [
  '_i18n/i18n', '_i18n/messages',
  'app/cockpit/webapp/i18n/i18n', 'app/decisions/webapp/i18n/i18n'
];

async function readBundle(path: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    assert.ok(separator > 0, `${path}: invalid resource entry`);
    const key = line.slice(0, separator).trim();
    assert.ok(!Object.hasOwn(entries, key), `${path}: duplicate key ${key}`);
    const value = line.slice(separator + 1).trim();
    assert.ok(value, `${path}: empty translation ${key}`);
    entries[key] = value;
  }
  return entries;
}

describe('DE/EN labels across the application', () => {
  it('provides both languages and matching placeholders in every application bundle', async () => {
    for (const path of bundles) {
      const de = await readBundle(path + '.properties');
      const en = await readBundle(path + '_en.properties');
      assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort(), path);
      for (const key of Object.keys(de)) {
        const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
        assert.deepEqual(placeholders(de[key]!), placeholders(en[key]!), `${path}: ${key}`);
      }
    }
  });

  it('labels all displayable OData entity fields, including optional columns and generated foreign keys', async () => {
    const model = await cds.load('*');
    const odata = cds.compile.for.odata(model);
    const translations = cds.i18n.bundle4(model);
    assert.ok(odata.definitions);
    let checked = 0;
    for (const [name, entity] of Object.entries(odata.definitions)) {
      if (!name.startsWith('ProcurementService.') || entity.kind !== 'entity') continue;
      for (const [field, element] of Object.entries(entity.elements ?? {})) {
        // Navigation links, hidden controls and draft-message collections are not table fields.
        if (element.target || element.items || element['@UI.Hidden']) continue;
        const label = element['@Common.Label'];
        assert.equal(typeof label, 'string', `${name}.${field}: no field label`);
        const key = /^\{i18n>([^}]+)\}$/.exec(label as string)?.[1];
        assert.ok(key, `${name}.${field}: label is not translatable`);
        for (const locale of ['de', 'en']) {
          const translated = translations.at(key, locale);
          assert.ok(typeof translated === 'string' && translated.trim(), `${name}.${field}: missing ${locale}`);
          assert.notEqual(translated, field, `${name}.${field}: raw property name in ${locale}`);
        }
        checked++;
      }
    }
    assert.ok(checked > 100, 'The audit must include the complete service model');
  });
});
