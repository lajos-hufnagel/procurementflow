import cds from '@sap/cds';
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Application, Request, Response } from 'express';
import { cleanExpiredSessions, createSession, csrfToken, findSession, revokeSession, type DemoSession } from './sessions.ts';

export const cookieName = () => cds.env.profiles.includes('production') ? '__Host-pf-demo' : 'pf-demo';
export function sessionCookie(req: Request): string {
  const cookies = (req.headers.cookie ?? '').split(';').map(part => part.trim());
  return cookies.find(part => part.startsWith(cookieName() + '='))?.slice(cookieName().length + 1) ?? '';
}
export function validCsrf(req: Request, token: string): boolean {
  const actual = req.get('X-Demo-CSRF') ?? '';
  const expected = csrfToken(token);
  return /^[0-9a-f]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export function allowedOrigin(req: Request): boolean {
  const actual = req.get('origin');
  if (!actual) return false;
  // In CF this is the public AppRouter origin, never a caller-supplied forwarding header.
  const configured = process.env.PUBLIC_DEMO_ORIGIN;
  if (cds.env.profiles.includes('production')) return !!configured && actual === configured;
  try { return ['localhost', '127.0.0.1'].includes(new URL(actual).hostname); } catch { return false; }
}
export function fail(res: Response, status: number, code: string): void {
  const messages: Record<string, [string, string]> = {
    DEMO_SESSION_EXPIRED: ['Ihre Demo-Sitzung ist abgelaufen. Bitte laden Sie die Seite neu.', 'Your demo session has expired. Please reload the page.'],
    DEMO_ROLE_INVALID: ['Bitte wählen Sie eine gültige Demo-Rolle.', 'Please select a valid demo role.'],
    DEMO_CSRF_REQUIRED: ['Bitte laden Sie die Seite neu und versuchen Sie es erneut.', 'Please reload the page and try again.'],
    DEMO_ORIGIN_REQUIRED: ['Bitte öffnen Sie die Demo über den öffentlichen Link.', 'Please open the demo using its public link.'],
    DEMO_RATE_LIMIT: ['Zu viele Anfragen. Bitte versuchen Sie es gleich erneut.', 'Too many requests. Please try again shortly.'],
    DEMO_CAPACITY: ['Die Demo ist gerade ausgelastet. Bitte versuchen Sie es später erneut.', 'The demo is currently at capacity. Please try again later.'],
    DEMO_SCENARIO_INVALID: ['Bitte wählen Sie ein gültiges Demo-Szenario.', 'Please select a valid demo scenario.'],
    DEMO_SCENARIO_FAILED: ['Das Demo-Szenario konnte nicht geändert werden. Bitte versuchen Sie es erneut.', 'The demo scenario could not be changed. Please try again.'],
    DEMO_START_FAILED: ['Die Demo konnte nicht gestartet werden. Bitte versuchen Sie es erneut.', 'The demo could not be started. Please try again.']
  };
  const english = /^en/i.test(res.req.get('Accept-Language') ?? '');
  res.status(status).json({ error: { code, message: messages[code]?.[english ? 1 : 0] ?? code } });
}
const buckets = new Map<string, { count: number; until: number }>();
export function permit(key: string, limit: number, windowMs = 60000): boolean {
  const now = Date.now();
  for (const [name, bucket] of buckets) if (bucket.until <= now) buckets.delete(name);
  const bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= 2000) return false;
    buckets.set(key, { count: 1, until: now + windowMs }); return true;
  }
  return ++bucket.count <= limit;
}
function reply(res: Response, session: DemoSession, token: string) {
  const secure = cds.env.profiles.includes('production') ? '; Secure' : '';
  const age = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
  res.set('Set-Cookie', `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`);
  res.set('Cache-Control', 'no-store').json({ csrfToken: csrfToken(token), expiresAt: session.expiresAt, scenario: session.erpOutage ? 'erp-outage' : 'normal' });
}

export function registerDemoHttp(app: Application): void {
  if (cds.env.profiles.includes('production')) {
    const origin = new URL(process.env.PUBLIC_DEMO_ORIGIN ?? '');
    if (origin.protocol !== 'https:' || origin.origin !== process.env.PUBLIC_DEMO_ORIGIN) throw new Error('PUBLIC_DEMO_ORIGIN must be the HTTPS AppRouter origin.');
  }
  // Serialize new-session allocation within the single demo app instance.
  let allocating = Promise.resolve();
  const start = (reset: boolean) => async (req: Request, res: Response) => {
    if (!allowedOrigin(req) || req.get('X-Demo-Bootstrap') !== '1') return fail(res, 403, 'DEMO_ORIGIN_REQUIRED');
    const token = sessionCookie(req);
    const existing = await findSession(token);
    if (existing && !reset) return reply(res, existing, token);
    if (reset && (!existing || !validCsrf(req, token))) return fail(res, 403, 'DEMO_CSRF_REQUIRED');
    if (!permit('new-sessions', 30)) {
      res.set('Retry-After', '60'); return fail(res, 429, 'DEMO_RATE_LIMIT');
    }
    const work = allocating.then(async () => {
      const fresh = await createSession();
      if (existing) await revokeSession(existing.ID);
      reply(res, fresh.session, fresh.token);
    });
    allocating = work.catch(() => {});
    try { await work; } catch (error) {
      const status = (error as { status?: number }).status === 503 ? 503 : 500;
      cds.log('public-demo').error('Demo initialization failed', { code: status });
      fail(res, status, status === 503 ? 'DEMO_CAPACITY' : 'DEMO_START_FAILED');
    }
  };
  app.post('/demo/session', start(false));
  app.post('/demo/reset', start(true));
  app.get('/demo/scenario', async (req, res) => {
    const session = await findSession(sessionCookie(req));
    if (!session) return fail(res, 401, 'DEMO_SESSION_EXPIRED');
    res.set('Cache-Control', 'no-store').json({ scenario: session.erpOutage ? 'erp-outage' : 'normal' });
  });
  app.post('/demo/scenario', express.json({ limit: '1kb' }), async (req, res) => {
    const token = sessionCookie(req);
    const session = await findSession(token);
    if (!session) return fail(res, 401, 'DEMO_SESSION_EXPIRED');
    if (!allowedOrigin(req) || !validCsrf(req, token)) return fail(res, 403, 'DEMO_CSRF_REQUIRED');
    const scenario = req.body?.scenario;
    if (!['normal', 'erp-outage'].includes(scenario) || Object.keys(req.body).some(key => key !== 'scenario')) {
      return fail(res, 400, 'DEMO_SCENARIO_INVALID');
    }
    if (!permit('scenario:' + session.ID, 30)) { res.set('Retry-After', '60'); return fail(res, 429, 'DEMO_RATE_LIMIT'); }
    try {
      // The cookie selects the owner. Neither a role nor an ID in the request can target another visitor.
      const changed = await cds.db.run(cds.ql.UPDATE.entity('procurement.DemoSessions')
        .set({ erpOutage: scenario === 'erp-outage' }).where({ ID: session.ID, expiresAt: { '>': new Date().toISOString() } }));
      if (changed !== 1) return fail(res, 401, 'DEMO_SESSION_EXPIRED');
      res.set('Cache-Control', 'no-store').json({ scenario });
    } catch {
      cds.log('public-demo').error('Demo scenario could not be saved.');
      fail(res, 500, 'DEMO_SCENARIO_FAILED');
    }
  });
  let running: Promise<unknown> | undefined;
  const cleanup = () => {
    if (running) return;
    running = cleanExpiredSessions().catch(() => cds.log('public-demo').error('Expired demo cleanup failed; will retry.'))
      .finally(() => { running = undefined; });
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  cds.once('listening', () => { cleanup(); timer = setInterval(cleanup, 60000); timer.unref(); });
  cds.once('shutdown', async () => { if (timer) clearInterval(timer); await running; });
}
