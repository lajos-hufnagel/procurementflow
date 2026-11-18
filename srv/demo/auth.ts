import cds from '@sap/cds';
import type { Request, Response, NextFunction } from 'express';
import { allowedOrigin, fail, permit, sessionCookie, validCsrf } from './http.ts';
import { findSession } from './sessions.ts';

const roles: Record<string, string[]> = { buyer: ['Buyer'], approver: ['Approver'], reader: ['Reader'], dual: ['Buyer', 'Approver'] };

/** Public, explicitly simulated identities. A random server-issued cookie owns the data scope. */
export default async function demoAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = sessionCookie(req);
  const session = await findSession(token);
  if (!session) return fail(res, 401, 'DEMO_SESSION_EXPIRED');
  const role = req.get('X-Demo-Role') ?? 'buyer';
  if (!Object.hasOwn(roles, role)) return fail(res, 403, 'DEMO_ROLE_INVALID');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!allowedOrigin(req) || !validCsrf(req, token))) {
    return fail(res, 403, 'DEMO_CSRF_REQUIRED');
  }
  if (!permit('api:' + session.ID, 360)) { res.set('Retry-After', '60'); return fail(res, 429, 'DEMO_RATE_LIMIT'); }
  cds.context!.user = new cds.User({ id: `demo:${session.ID}:${role}`, roles: roles[role]!, attr: { demoScope: session.ID } });
  next();
}
