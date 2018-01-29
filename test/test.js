const DB_NAME = 'lightninggemmochatest';
process.env.DB_NAME = DB_NAME; //use a separate database for mocha testing
const INITIAL_GEM_PRICE = 100;

const assert = require('assert');
const http = require('http');
const request = require('supertest');

const MongoClient = require('mongodb').MongoClient;
const dbUrl = "mongodb://127.0.0.1:27017";

describe('LightningGem', () => {
  let lightningGem;
  let app;
  let r_hash;

  before(async () => {
    const connection = await MongoClient.connect(dbUrl);
    const db = connection.db(DB_NAME);
    
    //start with a fresh database
    await db.collection('gems').remove();
    await db.collection('invoices').remove();
    connection.close();
    lightningGem = require('../lightninggem.js');
    app = lightningGem.app;
  });

  it('should GET the initial status', () => {
    return request(app) 
      .get('/status')
      .set('Accept', 'application/json')
      .expect(200)
      .expect('Content-Type', /json/)
      .then((status) => {
        assert.equal(status.body.gem._id, 1);
        assert.equal(status.body.gem.price, INITIAL_GEM_PRICE);
      });
  });

  it('should POST an invoice, simulate a payment, and transfer ownership', () => {
    const req = {
      name: 'mocha',
      gem_id: 1,
      value: INITIAL_GEM_PRICE
    }
    return request(app)
      .post('/invoice')
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(req)
      .then((invoice) => {
        const paidInvoice = {
          settled: true,
          r_hash: invoice.body.r_hash
        };
        return lightningGem.invoiceHandler(paidInvoice);
      }).then(() => {
        request(app)
          .get('/status')
          .set('Accept', 'application/json')
          .expect(200)
          .expect('Content-Type', /json/)
          .then((status) => {
            assert.equal(status.gem._id, 2);
            assert.equal(status.gem.price, 130);
          });
      })
  });
});
