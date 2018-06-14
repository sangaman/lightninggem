const grpc = require('grpc');
const fs = require('fs');

const { LND_MACAROON_PATH } = process.env;

const adminMacaroon = fs.readFileSync(LND_MACAROON_PATH);
const meta = new grpc.Metadata();
meta.add('macaroon', adminMacaroon.toString('hex'));

module.exports = meta;
