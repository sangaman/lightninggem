process.env.LN_GEM_PORT = 13371;
process.env.LN_GEM_INTERNAL_PORT = 13372;
process.env.DB_NAME = 'lightninggemmochatest';
const assert = require('assert');
const lightningGem = require('../lightninggem.js');

const MongoClient = require('mongodb').MongoClient;
const dbUrl = "mongodb://127.0.0.1:27017";

describe('LightningGem', () => {
  let gem;
  let db;

  before(async () => {
    const connection = await MongoClient.connect(dbUrl);
    db = connection.db('lightninggemmochatest');
    //start with a fresh database
    await db.collection('gems').drop();
    connection.close();
  });

  it('should create the first gem', async () => {
    gem = await lightningGem.getGem();
    assert.equal(gem._id, 1);
    assert.equal(gem.price, 100);
  });

  it('should create a new gem', async () => {
    const invoice = {
      name: 'mocha',
    };
    gem = await lightningGem.createGem(invoice, gem, false);
    assert.equal(gem._id, 2);
    assert.equal(gem.price, 130);
    assert.equal(gem.owner, 'mocha');
  });

  it('should get the new gem', async () => {
    gem = await lightningGem.getGem();
    assert.equal(gem._id, 2);
    assert.equal(gem.price, 130);
    assert.equal(gem.owner, 'mocha');
  });
});