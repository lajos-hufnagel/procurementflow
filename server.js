import cds from '@sap/cds';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import ODataAdapter from '@sap/cds/lib/srv/protocols/odata-v4.js';

// Public access is an explicit deployment profile; the ordinary production profile keeps XSUAA.
const publicDemo = cds.env.profiles.includes('public-demo');
let demoHttp;
if (publicDemo) {
  cds.env.server.cors = false;
  const extension = existsSync(resolve('srv/demo/auth.ts')) ? 'ts' : 'js';
  cds.env.requires.auth = { impl: resolve(`srv/demo/auth.${extension}`) };
  demoHttp = await import(`./srv/demo/http.${extension}`);
}

// CAP 10.2 decodes the entire URL before parsing it. A bare encoded & in $search
// becomes a query separator, losing the search or rejecting the request. Quote
// only affected terms before the standard parser; this also runs for $batch reads.
// All routing, authentication, draft handling and error handling stay in CAP.
class SearchODataAdapter extends ODataAdapter {
  log_request(req, res, next) {
    try {
      req.url = req.url.replace(/([?&](?:\$|%24)search=)([^&]*)/gi, (match, prefix, encoded) => {
        const input = decodeURIComponent(encoded);
        if (!input.includes('&')) return match;
        const tokens = input.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/gu) ?? [];
        const quoted = tokens.map(token => token.includes('&') && !/^".*"$/s.test(token) ? JSON.stringify(token) : token).join(' ');
        return prefix + encodeURIComponent(quoted);
      });
      super.log_request(req, res, next);
    } catch (error) {
      if (error instanceof URIError) error.status = 400;
      next(error);
    }
  }
}

// Configure the standard OData adapter with a narrow search URL correction.
cds.env.protocols = { ...cds.env.protocols, 'odata-v4': {
  ...cds.env.protocols?.['odata-v4'], impl: SearchODataAdapter
} };

cds.on('bootstrap', app => {
  if (demoHttp) demoHttp.registerDemoHttp(app);
  cds.middlewares.add(function demoScope(_req, _res, next) {
    if (!publicDemo) cds.context.user.attr.demoScope = 'shared';
    next();
  }, { after: 'auth' });
  const cockpit = resolve('.local/ui5/cockpit');
  if (!cds.env.profiles.includes('production') && existsSync(cockpit)) {
    app.use('/cockpit/webapp', express.static(cockpit));
  }
  app.get('/app-config', (_req, res) => res.set('Cache-Control', 'no-store').json({
    publicDemo,
    localDemo: !publicDemo && !cds.env.profiles.includes('production') && cds.env.requires.auth?.kind === 'mocked'
  }));
});

export default cds.server;
