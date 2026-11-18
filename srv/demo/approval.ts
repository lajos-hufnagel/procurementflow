import type { Request } from '@sap/cds';
import { publicDemoEnabled } from './scope.ts';

/** Explicit exception for the server-authenticated Dual identity in its own public demo session. */
export function demoSelfApprovalAllowed(req: Request): boolean {
  const scope = req.user.attr.demoScope;
  return publicDemoEnabled()
    && typeof scope === 'string' && /^[0-9a-f-]{36}$/.test(scope)
    && req.user.id === `demo:${scope}:dual`
    && req.user.is('Buyer') && req.user.is('Approver');
}
