require('dotenv').config();

process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA';

const lightningGem = require('./lightninggem/lightning-gem');
const lndInfo = require('./lndinfo/lnd-info');

lightningGem.init();
lndInfo.init();
