// Copied into gen/srv/scripts. Execute as an explicit CF task after HDI deployment.
import cds from '@sap/cds';
import { initializeEmptyDemo } from '../srv/lib/demo-seed.js';

cds.model = await cds.load('srv/csn.json');
const db = await cds.connect.to('db');
try {
  console.log('Demo data initialized in one transaction:', await initializeEmptyDemo('demo-data'));
} finally {
  await db.disconnect();
}
