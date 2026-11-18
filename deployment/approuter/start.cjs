const router = require('@sap/approuter')();
const publicDemo = process.env.PUBLIC_DEMO === 'true';
router.start({ xsappConfig: require(publicDemo ? './xs-app.public-demo.json' : './xs-app.json') });
