const helmet = require('helmet');
const cache = require('memory-cache');
const RateLimit = require('express-rate-limit');
const os = require('os');
const createLightning = require('../lightning/create-lightning');
const meta = require('../lightning/meta');
const logger = require('winston');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const { LN_INFO_PORT } = process.env;

const lightning = createLightning();

const jsonParser = bodyParser.json();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(helmet());
app.enable('trust proxy');

const rpcLimiter = new RateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  delayMs: 0,
  message: 'Too many requests from this IP, please try again after 10 minutes.',
});
app.use('/rpc/', rpcLimiter);

function responseHandler(err, response) {
  if (err) {
    logger.error(err);
    this.status(500).send(err);
  } else {
    this.status(200).json(response);
  }
}

app.get('/mem', (req, res) => {
  let mem = cache.get('mem');
  if (!mem) {
    mem = {
      free: os.freemem(),
      total: os.totalmem(),
    };
    cache.put('mem', mem, 10 * 1000);
  }
  res.status(200).json(mem);
});

app.get('/rpc/getinfo', (req, res) => {
  if (cache.get('getinfo')) { res.status(200).json(cache.get('getinfo')); } else {
    lightning.getInfo({}, meta, (err, response) => {
      if (err) {
        logger.error(err);
        res.status(500).send(err);
      } else {
        cache.put('getinfo', response, 30 * 1000);
        res.status(200).json(response);
      }
    });
  }
});

app.get('/rpc/pendingchannels', (req, res) => {
  if (cache.get('pendingchannels')) { res.status(200).json(cache.get('pendingchannels')); } else {
    lightning.pendingChannels({}, meta, (err, response) => {
      if (err) {
        logger.error(err);
        res.status(500).send(err);
      } else {
        cache.put('pendingchannels', response, 30 * 1000);
        res.status(200).json(response);
      }
    });
  }
});

app.get('/rpc/listchannels', (req, res) => {
  if (cache.get('listchannels')) { res.status(200).json(cache.get('listchannels')); } else {
    lightning.listChannels({}, meta, (err, response) => {
      if (err) {
        logger.error(err);
        res.status(500).send(err);
      } else {
        cache.put('listchannels', response, 30 * 1000);
        res.status(200).json(response);
      }
    });
  }
});

app.post('/rpc/decodepayreq', jsonParser, (req, res) => {
  lightning.decodePayReq({
    pay_req: req.body.paymentRequest,
  }, meta, responseHandler.bind(res));
});

app.post('/rpc/getnodeinfo', jsonParser, (req, res) => {
  lightning.getNodeInfo({
    pub_key: req.body.publicKey,
  }, meta, responseHandler.bind(res));
});

app.get('/rpc/getnetworkinfo', (req, res) => {
  if (cache.get('getnetworkinfo')) { res.status(200).json(cache.get('getnetworkinfo')); } else {
    lightning.getNetworkInfo({}, meta, (err, response) => {
      if (err) {
        logger.error(err);
        res.status(500).send(err);
      } else {
        cache.put('getnetworkinfo', response, 180 * 1000);
        res.status(200).json(response);
      }
    });
  }
});

app.post('/rpc/lookupinvoice', jsonParser, (req, res) => {
  lightning.lookupInvoice({
    r_hash_str: req.body.paymentHash,
  }, meta, responseHandler.bind(res));
});

app.post('/rpc/addinvoice', jsonParser, (req, res) => {
  lightning.addInvoice({
    value: req.body.value,
  }, meta, responseHandler.bind(res));
});

app.post('/rpc/queryroutes', jsonParser, (req, res) => {
  lightning.queryRoutes({
    pub_key: req.body.publicKey,
    amt: req.body.amount,
  }, meta, responseHandler.bind(res));
});

async function init() {
  app.listen(LN_INFO_PORT, () => {
    logger.info(`LND Info listening on port ${LN_INFO_PORT}`);
  });
}

module.exports = { init };
