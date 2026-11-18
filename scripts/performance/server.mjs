import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const cds = createRequire(resolve('package.json'))('@sap/cds');
cds.env.log.levels.odata = 'error';
cds.env.log.levels.sql = 'error';
let peakRssBytes = process.memoryUsage().rss;
setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 50).unref();
process.on('message', message => {
  if (message.type !== 'metrics') return;
  const memory = process.memoryUsage();
  if (message.reset) peakRssBytes = memory.rss;
  peakRssBytes = Math.max(peakRssBytes, memory.rss);
  process.send?.({ type: 'metrics', id: message.id, cpu: process.cpuUsage(), rssBytes: memory.rss, peakRssBytes });
});
cds.on('listening', ({ url }) => process.send?.({ type: 'ready', url }));
await cds.exec('--port', '0');
