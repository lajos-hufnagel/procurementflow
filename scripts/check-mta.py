"""Inspect the actual MBT archive without extracting or executing its contents."""
import hashlib
import io
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

archive = Path(sys.argv[1] if len(sys.argv) > 1 else 'mta_archives/procurementflow.mtar')
expected = {'pf-srv', 'pf-erp', 'pf-router', 'pf-db-deployer', 'pf-erp-db-deployer'}
business_tables = ['Materials', 'Suppliers', 'Demands', 'Offers', 'Cases', 'DecisionWorkspaces']
modules = {}
with zipfile.ZipFile(archive) as outer:
    assert outer.testzip() is None, 'Corrupt MTA archive'
    assert {name.split('/')[0] for name in outer.namelist() if name.endswith('/data.zip')} == expected
    assert 'META-INF/mtad.yaml' in outer.namelist()
    for module in sorted(expected):
        with zipfile.ZipFile(io.BytesIO(outer.read(f'{module}/data.zip'))) as inner:
            assert inner.testzip() is None, f'Corrupt module: {module}'
            names = inner.namelist()
            for name in names:
                parts = Path(name).parts
                assert not name.startswith('/') and '..' not in parts, name
                assert not {'node_modules', '.local', '.env', 'default-env.json', '.cdsrc-private.json'}.intersection(parts), name
                assert not re.search(r'\.(?:sqlite3?|db)(?:-|$)|\.ts$', name), name
                assert not any(part.startswith('.env.') for part in parts), name
            package = json.loads(inner.read('package.json'))
            lock = json.loads(inner.read('package-lock.json'))
            assert package['dependencies'] == lock['packages']['']['dependencies'], module
            assert package['engines']['node'] == lock['packages']['']['engines']['node'] == '24.x', module
            if module in {'pf-srv', 'pf-erp'}:
                production = package['cds']['requires']['[production]']
                assert production['auth']['kind'] == 'xsuaa' and production['db']['kind'] == 'hana'
                assert {'@cap-js/hana', '@sap/xssec'} <= package['dependencies'].keys()
                assert package['scripts'] == {'start': 'cds-serve'}
                assert 'devDependencies' not in package
                for path in ['srv/lib/demo-dates.js', 'scripts/shift-demo-dates.mjs', 'scripts/demo-dates-2026-11-18.json', 'scripts/demo-dates-2026-11-19.json']:
                    assert path in names, path
            if module == 'pf-srv':
                for path in ['srv/procurement-service.js', 'srv/integration/destination-transport.js', 'srv/lib/demo-seed.js', 'srv/lib/search.js', 'scripts/seed-demo.mjs', 'srv/demo/approval.js', 'srv/demo/auth.js', 'srv/demo/http.js', 'srv/demo/sessions.js', 'srv/demo/scope.js']:
                    assert path in names, path
                for table in business_tables:
                    assert f'demo-data/procurement.{table}.csv' in names
            if module == 'pf-erp':
                assert 'srv/erp-service.js' in names
            if module == 'pf-router':
                routes = json.loads(inner.read('xs-app.json'))
                assert routes['authenticationMethod'] == 'route'
                assert all(route['authenticationType'] == 'xsuaa' for route in routes['routes'])
                api = routes['routes'][0]
                assert api['destination'] == 'srv-api' and api['csrfProtection'] is True
                for path in ['/procurement', '/procurement/$metadata', '/procurement/$batch', '/procurement/Cases', '/app-config']:
                    assert re.fullmatch(api['source'], path), path
                assert not re.fullmatch(api['source'], '/erp/Orders')
                for app in ['cockpit', 'decisions']:
                    assert f'resources/{app}/webapp/Component-preload.js' in names
                assert 'resources/shared/bootstrap.js' in names
                assert 'resources/decisions/webapp/ext/History.js' in names
                assert 'resources/shared/DemoScenario.js' in names
                assert 'start.cjs' in names
                public_config = json.loads(inner.read('xs-app.public-demo.json'))
                assert 'welcomeFile' not in public_config
                assert 'resources/index.html' in names and 'resources/shared/entry.js' in names
                public_routes = public_config['routes']
                assert all(route['authenticationType'] == 'none' for route in public_routes)
                assert public_routes[0]['csrfProtection'] is False
                assert re.fullmatch(public_routes[0]['source'], '/demo/session')
                assert re.fullmatch(public_routes[0]['source'], '/demo/reset')
                assert re.fullmatch(public_routes[0]['source'], '/demo/scenario')
                assert not re.fullmatch(public_routes[0]['source'], '/erp/Orders')
            if module == 'pf-db-deployer':
                assert 'src/gen/procurement.Cases.hdbtable' in names
                assert 'erpOutage BOOLEAN NOT NULL DEFAULT FALSE' in inner.read('src/gen/procurement.DemoSessions.hdbtable').decode()
                assert 'src/gen/data/procurement.CaseStatuses.hdbtabledata' in names
                for table in business_tables:
                    assert f'src/gen/data/procurement.{table}.hdbtabledata' not in names
                    assert f'src/gen/data/procurement.{table}.csv' not in names
            if module == 'pf-erp-db-deployer':
                assert 'src/gen/erp.Orders.hdbtable' in names
            modules[module] = {'files': sum(not name.endswith('/') for name in names), 'productionDependencies': package['dependencies']}
    security = json.loads(outer.read('xs-security.json'))
    assert {scope['name'] for scope in security['scopes']} == {'$XSAPPNAME.Buyer', '$XSAPPNAME.Approver', '$XSAPPNAME.Reader'}
    assert {collection['name']: collection['role-template-references']
            for collection in security['role-collections']} == {
        f'ProcurementFlow_{role}': [f'$XSAPPNAME.{role}']
        for role in ('Buyer', 'Approver', 'Reader')
    }
    erp_security = json.loads(outer.read('erp/xs-security.json'))
    assert erp_security['authorities'] == ['$XSAPPNAME.Integration']
    assert {scope['name'] for scope in erp_security['scopes']} == {'$XSAPPNAME.Integration'}
    assert erp_security['role-templates'] == []
result = {
    'checkedAt': datetime.now(timezone.utc).isoformat(),
    'artifact': archive.name, 'bytes': archive.stat().st_size,
    'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'modules': modules, 'cloudDeploymentExecuted': False,
    'checks': ['archive integrity', 'compiled runtime files', 'matching lockfiles', 'production HANA/XSUAA configuration',
               'separate ERP authority', 'protected default router routes', 'explicit public demo router variant', 'both UI5 bundles',
               'business demo data excluded from HDI import', 'no local data or host node_modules']
}
Path('.local').mkdir(exist_ok=True)
Path('.local/mta-check.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
