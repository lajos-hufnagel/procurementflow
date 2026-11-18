import { createReader, createWorkspace, createResource } from '@ui5/fs/resourceFactory';
import generateFlexChangesBundle from '@ui5/builder/tasks/bundlers/generateFlexChangesBundle';
import generateComponentPreload from '@ui5/builder/tasks/bundlers/generateComponentPreload';
import { transformAsync } from '@babel/core';
import ui5Preset from 'babel-preset-transform-ui5';
import tsPreset from '@babel/preset-typescript';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const dev = process.argv.includes('--dev');
async function build(name) {
  const namespace = `procurementflow/${name}`;
  const prefix = `/resources/${namespace}/`;
  const source = resolve(`app/${name}/webapp`);
  const destination = resolve(dev ? `.local/ui5/${name}` : `gen/srv/app/${name}/webapp`);
  const workspace = createWorkspace({ reader: createReader({ fsBasePath: source, virBasePath: prefix }) });
  for (const resource of await workspace.byGlob(prefix + '**/*.ts')) {
    if (resource.getPath().endsWith('.d.ts')) continue;
    const relative = resource.getPath().slice(prefix.length);
    const result = await transformAsync(await resource.getString(), {
      filename: resolve(source, relative), sourceRoot: resolve(`app/${name}`),
      babelrc: false, configFile: false, sourceMaps: false,
      presets: [[ui5Preset, { sourceFolders: { webapp: `procurementflow.${name}` } }],
        [tsPreset, { allowDeclareFields: true, onlyRemoveTypeImports: true }]]
    });
    if (!result) throw new Error(`No compilation result for ${relative}`);
    if (!result.code?.trim()) continue; // A module containing only interfaces has no runtime resource.
    await workspace.write(createResource({ path: resource.getPath().replace(/\.ts$/, '.js'), string: result.code }));
  }
  await generateFlexChangesBundle({ workspace, options: { projectNamespace: namespace } });
  if (!dev) await generateComponentPreload({ workspace, options: {
    projectName: `procurementflow-${name}`, namespaces: [namespace], excludes: [namespace + '/bootstrap.js']
  } });
  await rm(destination, { recursive: true, force: true });
  for (const resource of await workspace.byGlob(prefix + '**/*')) {
    if (resource.getPath().endsWith('.ts')) continue;
    const file = resolve(destination, resource.getPath().slice(prefix.length));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await resource.getBuffer());
  }
  if (!dev) {
    const index = resolve(destination, 'index.html');
    await writeFile(index, (await readFile(index, 'utf8')).replace('    data-sap-ui-xx-component-preload="off"\n', ''));
  }
}
await build('cockpit');
if (!dev) {
  await build('decisions');
  await cp('app/shared', 'gen/srv/app/shared', { recursive: true });
  await cp('app/index.html', 'gen/srv/app/index.html');
  await cp('server.js', 'gen/srv/server.js');
  const manifestFile = 'gen/srv/package.json';
  const runtime = JSON.parse(await readFile(manifestFile, 'utf8'));
  runtime.scripts = { start: 'cds-serve' }; // Runtime must not invoke source-only dev tooling.
  await writeFile(manifestFile, JSON.stringify(runtime, null, 2) + '\n');
}
console.log(dev ? 'TypeScript cockpit built: .local/ui5/cockpit' : 'Fiori Elements and TypeScript cockpit bundled with UI5 Builder: gen/srv/app');
