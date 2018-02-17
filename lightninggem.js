require('dotenv').config();

const {
  LND_HOMEDIR,
  LN_GEM_PORT,
  DB_NAME,
  LND_CONNECTION_STRING,
  NODE_ENV,
} = process.env;

const grpc = require('grpc');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const schedule = require('node-schedule');
const logger = require('winston');

const LND_UNAVAILABLE = {
  status: 503,
  message: 'LND on server is down',
};

const logDir = 'log';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const lndCert = fs.readFileSync(`${LND_HOMEDIR}tls.cert`);
const credentials = grpc.credentials.createSsl(lndCert);
const lnrpcDescriptor = grpc.load('rpc.proto');
const lightning = new lnrpcDescriptor.lnrpc.Lightning('127.0.0.1:10009', credentials);

const adminMacaroon = fs.readFileSync(`${LND_HOMEDIR}admin.macaroon`);
const meta = new grpc.Metadata();
meta.add('macaroon', adminMacaroon.toString('hex'));

const express = require('express');
const bodyParser = require('body-parser');

const urlencodedParser = bodyParser.urlencoded({
  extended: true,
});

const { MongoClient } = require('mongodb');

const dbUrl = 'mongodb://127.0.0.1:27017';

const app = express();
app.use(express.static('public'));
app.use(helmet());
let db;

/**
 * The current gem containing the owner's details
 */
let gem;

/**
 * The sum of all outgoing payments
 */
let paidOutSum;

/**
 * An array of recent gems
 */
let recentGems;

const RECENT_GEMS_MAX_LENGTH = 6;

/**
 * A map of invoice r_hashes to response objects for clients
 * listening for when those invoices are settled or terminated
 */
let listeners = {};

// scheduled function to run once a day
const dailyRule = new schedule.RecurrenceRule();
dailyRule.hour = 12;
dailyRule.minute = 0;
const secretsStream = fs.createWriteStream('public/secrets.txt', {
  flags: 'a',
});
schedule.scheduleJob(dailyRule, async () => {
  // publish yesterday's secret
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const secret = await db.collection('secrets').findOne({
    _id: yesterday.toISOString().split('T')[0],
  });
  secretsStream.write(`${secret._id} ${secret.secret}\n`);
});

/**
 * Creates an index on r_hash for invoices if it doesn't exist.
 * Fetches the most recent gem from the database. If no gem
 * exists, it creates one. Also computes lifetime payouts.
 * @returns - A promise that resolves when the gem is initialized
 */
async function init() {
  db.collection('invoices').createIndex('r_hash', {
    unique: true,
  }).then(() => db.collection('gems').find().sort({
    _id: -1,
  }).toArray()).then(async (gems) => {
    paidOutSum = 0;
    if (gems[0]) {
      recentGems = [];
      [gem] = gems;
      for (let n = 0; n < gems.length; n += 1) {
        if (gems[n].paid_out) { paidOutSum += Math.round(gems[n + 1].price * 1.25); }
        if (n < RECENT_GEMS_MAX_LENGTH) { recentGems.push(gems[n]); }
      }
    } else {
      // this is the very first gem in the series!
      gem = {
        price: 100,
        _id: 1,
        date: new Date().getTime(),
      };
      recentGems = [gem];
      await db.collection('gems').insertOne(gem);
    }
  });
}

/**
 * Validates an outgoing payment request.
 * @param pay_req_out - The payment request to validate
 * @returns - A promise that resolves when the request is validated.
 */
async function validatePayReq(payReq) {
  if (payReq) {
    const invoiceQuery = {
      pay_req_out: payReq,
      status: { $gt: 0 },
    };

    const invoice = await db.collection('invoices').findOne(invoiceQuery);
    if (invoice) {
      throw new Error('Payment request has already been paid');
    }
    return new Promise((resolve, reject) => lightning.decodePayReq({
      pay_req: payReq,
    }, meta, (err, response) => {
      if (err) {
        if (err.code === 14) {
          reject(LND_UNAVAILABLE);
        } else {
          reject(new Error(`Could not decode payment request: ${err.message}`));
        }
      } else if (parseInt(response.num_satoshis, 10) !== Math.round(gem.price * 1.25)) {
        reject(new Error('Invalid payment request value'));
      } else if (response.expiry < 43200) {
        reject(new Error('Invalid payment request value'));
      } else {
        resolve(true);
      }
    }));
  }
  return true;
}

/**
 * Adds an invoice to lnd.
 * @param value - The amount in satoshis for the invoice
 * @returns - A promise that resolves when the invoice is added
 */
function addInvoice(value) {
  return new Promise((resolve, reject) => lightning.addInvoice({
    value,
    memo: 'Lightning Gem',
  }, meta, (err, response) => {
    if (err) {
      if (err.code === 14) {
        reject(LND_UNAVAILABLE);
      } else {
        const error = new Error(`Server error: ${err.message}`);
        error.status = 500;
        reject(error);
      }
    } else {
      resolve(response);
    }
  }));
}

app.get('/status', (req, res) => {
  res.status(200).json({
    recentGems,
    paidOutSum,
    lndConnectionString: LND_CONNECTION_STRING,
  });
});

app.get('/listen/:r_hash', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  listeners[req.params.r_hash] = res;
});

app.post('/invoice', urlencodedParser, (req, res) => {
  logger.info(`invoice request: ${JSON.stringify(req.body)}`);
  if (!req.body.name || req.body.name.length > 50 || (req.body.url && req.body.url.length > 150)) {
    res.status(400).end(); // this shouldn't happen, there's client-side validation to prevent this
  } else if (gem._id !== parseInt(req.body.gem_id, 10)) {
    res.status(400).send('Gem out of sync, try refreshing');
  } else {
    // valid so far, check for and validate payment request
    let responseBody;
    validatePayReq(req.body.pay_req_out).then(() => addInvoice(gem.price)).then((response) => {
      const rHash = response.r_hash.toString('hex');
      responseBody = {
        r_hash: rHash,
        payment_request: response.payment_request,
      };

      const invoice = {
        gemId: req.body.gem_id,
        name: req.body.name,
        url: req.body.url,
        r_hash: response.r_hash.toString('hex'),
        value: gem.price,
      };
      if (req.body.pay_req_out) { invoice.pay_req_out = req.body.pay_req_out; }
      return invoice;
    }).then(invoice => db.collection('invoices').replaceOne({
      r_hash: responseBody.r_hash,
    }, invoice, {
      upsert: true,
    }))
      .then(() => {
        logger.verbose(`invoice added: ${JSON.stringify(responseBody)}`);
        res.status(200).json(responseBody);
      })
      .catch((err) => {
        if (err.status) {
          logger.error(err.message);
          res.status(err.status).send(err.message);
        } else {
          logger.error(err);
          res.status(400).send(err.message);
        }
      });
  }
});

/**
 * Sends a lightning payment
 * @param payReq - The payment request to pay
 * @returns - A promise that resolves when the payment is sent
 */
function sendPayment(payReq) {
  return new Promise((resolve, reject) => lightning.sendPaymentSync({
    payment_request: payReq,
  }, meta, (err, response) => {
    if (err) {
      reject(err);
    } else if (response.payment_error) {
      reject(new Error(response.payment_error));
    } else {
      resolve(response);
    }
  }));
}

/**
 * Creates a new gem according to the rules of the Lightning
 * Gem, adjusting the price, id, and owner as necessary.
 * @returns - The newly created gem
 */
async function createGem(invoice, oldGem, reset) {
  const newGem = {
    _id: oldGem._id + 1,
    date: new Date().getTime(),
  };
  if (reset) {
    newGem.price = 100;
  } else {
    newGem.price = Math.round(oldGem.price * 1.3);
    newGem.owner = invoice.name;
    newGem.url = invoice.url;
    newGem.pay_req_out = invoice.pay_req_out;
  }

  await db.collection('gems').insertOne(newGem);
  logger.info(`new gem: ${JSON.stringify(newGem)}`);
  recentGems.unshift(newGem);
  if (RECENT_GEMS_MAX_LENGTH) {
    recentGems.pop();
  }

  return newGem;
}

/**
 * Send an event to and close a connection.
 * @param event - The event type to send
 * @param rHash - The r_hash corresponding to the listening client
 */
function sendEvent(event, rHash) {
  const listener = listeners[rHash];
  if (listener && !listener.finished) {
    try {
      listener.write(`data: ${event}\n\n`);
      // listeners[listener_r_hash].set("Connection", "close");
      listener.end();
    } catch (err) {
      logger.error(err);
    }
  }
}

/**
 * Update and close connections with all listening clients
 * after gem purchase.
 * @param r_hash - The r_hash for the invoice that bought the gem
 * @param reset - Whether the gem purchase resulted in a reset
 */
function updateListeners(rHash, reset) {
  if (reset) { sendEvent('reset', rHash); } else { sendEvent('settled', rHash); }
  for (let n = 0; n < listeners.length; n += 1) {
    if (listeners[n] !== rHash) {
      sendEvent('expired', listeners[n]);
    }
  }
  listeners = {};
}

/**
 * Creates a new gem and updates all listening clients
 * @param invoice - The invoice database object for the purchase
 * @param r_hash - The r_hash for the invoice that bought the gem
 * @param reset - Whether the gem purchase resulted in a reset
 * @returns - A promise that resolves when the gem purchase is complete
 */
async function purchaseGem(invoice, rHash, reset) {
  try {
    const oldGem = gem;
    gem = await createGem(invoice, oldGem, reset);

    // update previous gem to mark it as bought and pay out previous owner
    oldGem.bought = true;
    if (reset) {
      oldGem.reset = true;
    }

    updateListeners(rHash, reset);

    try {
      if (oldGem.pay_req_out && !reset) {
        const paymentResponse = await sendPayment(oldGem.pay_req_out);
        logger.debug(`payment response: ${JSON.stringify(paymentResponse)}`);
        oldGem.paid_out = true;
        paidOutSum += Math.round(oldGem.price * 1.25);
        logger.info(`paid ${oldGem.pay_req_out}`);
      }
    } finally {
      // we want to update the old gem even if the sendpayment call above fails
      await db.collection('gems').replaceOne({
        _id: oldGem._id,
      }, oldGem);
    }
  } catch (err) {
    logger.error(err);
  }
}

// timer function to run every 2 minutes
try {
  setInterval(async () => {
    // check for timeout
    if (gem.owner && gem.date < (new Date().getTime() - (24 * 60 * 60 * 1000))) {
      try {
        gem = await createGem(null, gem, true);
        updateListeners(); // update all clients to indicate gem has expired
        logger.info('gem timed out');
      } catch (err) {
        logger.error(`error on gem reset: ${err}`);
      }
    }
  }, 2 * 60 * 1000);
} catch (err) {
  logger.error(err);
}
/**
 * Handler for updates on lightning invoices
 * @param data - The data from the lightning invoice subscription
 * @returns - A promise that resolves once the invoice is handled
 * and updated, or undefined if the invoice was not settled
 */
async function invoiceHandler(data) {
  if (data.settled) {
    const rHash = data.r_hash.toString('hex');
    const invoiceQuery = {
      r_hash: rHash,
    };

    try {
      const invoice = await db.collection('invoices').findOne(invoiceQuery);
      if (invoice) {
        logger.info(`invoice settled: ${JSON.stringify(invoice)}`);
        const newInvoiceVals = {
          $set: {},
        };
        let reset = false;

        if (gem._id === parseInt(invoice.gemId, 10)) {
          newInvoiceVals.$set.status = 1;

          if (invoice.pay_req_out) {
            // check for random reset
            const secret = await db.collection('secrets').findOne({
              _id: new Date().toISOString().split('T')[0],
            });
            const hash = crypto.createHash('sha256');
            hash.update(invoice.pay_req_out + secret.secret);
            const buf = hash.digest();
            const firstByteInt = buf.readUIntBE(0, 1);
            logger.debug(`first byte of sha256 hash for ${invoice.pay_req_out}${secret.secret} is ${firstByteInt}`);
            if (firstByteInt < 8) { reset = true; }
          }
          await purchaseGem(invoice, rHash, reset);
        } else {
          logger.info('stale invoice paid');
          sendEvent('stale', rHash);
          newInvoiceVals.$set.status = 2;
        }

        // update paid invoice
        return db.collection('invoices').updateOne(invoiceQuery, newInvoiceVals);
      }
    } catch (err) {
      logger.error(err);
      throw err;
    }
  }
  return false;
}

lightning.subscribeInvoices({}, meta).on('data', invoiceHandler).on('end', () => {
  logger.warn('subscribeInvoices ended');
}).on('status', (status) => {
  logger.debug(`subscribeInvoices status: ${JSON.stringify(status)}`);
})
  .on('error', (error) => {
    logger.error(`subscribeInvoices error: ${error}`);
  });

MongoClient.connect(dbUrl).then((connection) => {
  db = connection.db(DB_NAME);
  return init();
}).then(() => {
  // listen and write logs only when started directly
  if (!module.parent) {
    const tsFormat = () => (new Date()).toLocaleString();
    logger.configure({
      transports: [
        new (logger.transports.Console)({
          timestamp: tsFormat,
          colorize: true,
        }),
        new (logger.transports.File)({
          filename: `${logDir}/lightninggem.log`,
          timestamp: tsFormat,
        }),
      ],
    });

    logger.level = NODE_ENV === 'development' ? 'debug' : 'info';
    app.listen(LN_GEM_PORT, () => {
      logger.info(`App listening on port ${LN_GEM_PORT}`);
    });
  } else {
    // don't log at all if not started directly
    logger.clear();
  }
}).catch((err) => {
  logger.error(`Error on initialization: ${err}`);
});

module.exports = {
  app,
  init,
  invoiceHandler,
};
