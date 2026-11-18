import cds, { type Request, type ApplicationService } from '@sap/cds';

export const publicDemoEnabled = () => cds.env.profiles.includes('public-demo');

export function caseScope(req: Request): { demoScope: string } {
  const scope = publicDemoEnabled() ? req.user.attr.demoScope : 'shared';
  if (typeof scope !== 'string' || (scope !== 'shared' && !/^[0-9a-f-]{36}$/.test(scope))) {
    req.reject(401, 'DEMO_SESSION_EXPIRED');
  }
  if (publicDemoEnabled() && scope === 'shared') req.reject(403, 'DEMO_SESSION_REQUIRED');
  return { demoScope: scope as string };
}

export function registerDemoScope(service: ApplicationService): void {
  service.before('*', (req: Request) => {
    // An XSUAA attribute or an HTTP header must never select a visitor's case set.
    req.user.attr.demoScope = caseScope(req).demoScope;
  });
  service.before('READ', '*', async (req: Request) => {
    if (!req.target?.name.endsWith('DraftAdministrativeData')) return;
    const drafts = service.entities.DecisionWorkspaces!.drafts!;
    const rows = await cds.tx(req).run(cds.ql.SELECT.from(drafts).columns('DraftAdministrativeData_DraftUUID')
      .where({ 'procurementCase.demoScope': caseScope(req).demoScope })) as { DraftAdministrativeData_DraftUUID: string }[];
    (req.query as unknown as cds.ql.SELECT<unknown>).where({ DraftUUID: { in: rows.map(row => row.DraftAdministrativeData_DraftUUID) } });
  });
  service.after('READ', 'History', (result: unknown) => {
    if (!publicDemoEnabled()) return;
    for (const row of (Array.isArray(result) ? result : result ? [result] : []) as { actor?: string }[]) {
      // Keep the session-qualified actor in storage and draft locks; show the demo identity in the UI.
      if (row.actor) row.actor = row.actor.replace(/^demo:[0-9a-f-]{36}:/, '');
    }
  });
}
