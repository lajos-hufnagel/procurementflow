using { erp as db } from '../db/schema';

@protocol: 'rest'
@path: '/erp'
@requires: 'authenticated-user'
service ErpService {
  @restrict: [{ grant: ['READ', 'CREATE'], to: 'Integration' }]
  entity Orders as projection on db.Orders;

  // Local demonstration only. Production execution is also rejected by the handler.
  @requires: 'ErpAdmin'
  action simulate(mode: String(30) not null) returns { mode: String; };
}
