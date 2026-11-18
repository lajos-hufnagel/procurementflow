const mode = process.argv[2];
if (!['available', 'unavailable', 'drop-after-commit-once'].includes(mode)) {
  throw new Error('Use npm run erp:mode -- available|unavailable|drop-after-commit-once');
}
if (process.env.NODE_ENV === 'production') throw new Error('Local fault simulation is disabled in production.');
const port = process.env.ERP_PORT ?? '4005';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid ERP_PORT.');
const response = await fetch(`http://127.0.0.1:${port}/erp/simulate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json',
    Authorization: 'Basic ' + Buffer.from('erp-admin:demo-erp-admin').toString('base64') },
  body: JSON.stringify({ mode }), signal: AbortSignal.timeout(3000), redirect: 'error'
});
if (!response.ok) throw new Error(`ERP-Testmodus nicht gesetzt (HTTP ${response.status}). Läuft npm run demo?`);
console.log(`Lokaler ERP-Testmodus: ${mode}`);
