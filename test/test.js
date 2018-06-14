/* eslint-env mocha */

require('dotenv').config();

process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA';

const DB_NAME = 'lightninggemmochatest';
process.env.DB_NAME = DB_NAME; // use a separate database for mocha testing

const assert = require('assert');
const request = require('supertest');
const lightningGem = require('../lightninggem/lightning-gem');
const { MongoClient } = require('mongodb');

const { app } = lightningGem;

const dbUrl = 'mongodb://127.0.0.1:27017';

describe('LightningGem', () => {
  before(async () => {
    const connection = await MongoClient.connect(dbUrl);
    const db = connection.db(DB_NAME);

    // start with a fresh database
    await db.collection('gems').remove();
    await db.collection('invoices').remove();
    await connection.close();
    await lightningGem.init(true);
  });

  it('should GET the initial status', () => request(app)
    .get('/status')
    .set('Accept', 'application/json')
    .expect(200)
    .expect('Content-Type', /json/)
    .then((status) => {
      const gem = status.body.recentGems[0];
      assert.strictEqual(gem._id, 1);
      assert.strictEqual(gem.price, 100);
    }));

  it('should POST an invoice request, simulate a payment, and transfer ownership', () => {
    const req = {
      name: 'mocha',
      gem_id: 1,
    };
process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA';
    return request(app)
      .post('/invoice')
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(req)
      .expect(200)
      .expect('Content-Type', /json/)
      .then((invoice) => {
        const paidInvoice = {
          settled: true,
          r_hash: invoice.body.r_hash,
        };
        return lightningGem.invoiceHandler(paidInvoice);
      })
      .then(() => request(app)
        .get('/status')
        .set('Accept', 'application/json')
        .expect(200)
        .expect('Content-Type', /json/)
        .then((status) => {
          const gem = status.body.recentGems[0];
          assert.strictEqual(gem._id, 2);
          assert.strictEqual(gem.price, 130);
        }));
  });
});
