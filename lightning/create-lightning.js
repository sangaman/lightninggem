const grpc = require('grpc');
const fs = require('fs');

const { LND_CERT_PATH, LND_HOST } = process.env;

const lndCert = fs.readFileSync(LND_CERT_PATH);
const credentials = grpc.credentials.createSsl(lndCert);
const lnrpcDescriptor = grpc.load('rpc.proto');

module.exports = () => new lnrpcDescriptor.lnrpc.Lightning(LND_HOST || '127.0.0.1:10009', credentials);
