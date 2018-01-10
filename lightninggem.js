require('dotenv').config();
const grpc = require('grpc');
const fs = require("fs");
const crypto = require('crypto');
const helmet = require('helmet');

const LND_HOMEDIR = process.env.LND_HOMEDIR;
const LN_GEM_PORT = process.env.LN_GEM_PORT;
const LN_GEM_INTERNAL_PORT = process.env.LN_GEM_INTERNAL_PORT;

const lndCert = fs.readFileSync(LND_HOMEDIR + 'tls.cert');
const credentials = grpc.credentials.createSsl(lndCert);
const lnrpcDescriptor = grpc.load("rpc.proto");
const lnrpc = lnrpcDescriptor.lnrpc;
const lightning = new lnrpc.Lightning('127.0.0.1:10009', credentials);

const adminMacaroon = fs.readFileSync(LND_HOMEDIR + 'admin.macaroon');
const meta = new grpc.Metadata();
meta.add('macaroon', adminMacaroon.toString('hex'));

const express = require('express');
const bodyParser = require('body-parser');
const urlencodedParser = bodyParser.urlencoded({
    extended: true
});

const MongoClient = require('mongodb').MongoClient;
const dbUrl = "mongodb://127.0.0.1:27017";

const app = express();
app.use(express.static("public"));
app.use(helmet());
var db;
var gem;
var listeners = {};

const http = require('http');
http.createServer(checkTimeout).listen(LN_GEM_INTERNAL_PORT);

function checkTimeout(req, res) {
    gem = undefined;
    getGem(function(gem) {
        if (gem.owner && gem.date < (new Date().getTime() - 12 * 60 * 60 * 1000)) {
            gem = {
                _id: gem._id + 1,
                price: 100,
                date: new Date().getTime()
            };
            db.collection('gems').insertOne(gem).then(() => {
                console.log("gem timed out");
            }).catch((err) => {
                console.error("error on gem reset: " + err);
            });
        }
    });
    res.end();
}

MongoClient.connect(dbUrl).then((result) => {
    db = result.db('lightninggem');
    app.listen(LN_GEM_PORT, function() {
        console.log('App listening on port ' + LN_GEM_PORT);
    });
}).catch((err) => {
    throw err;
});

function getGem(callback) {
    if (gem)
        callback(gem);
    else
        db.collection('gems').find().sort({
            _id: -1
        }).limit(1).toArray().then((gems) => {
            gem = gems[0];
            callback(gems[0]);
        }).catch((err) => {
            console.error(err);
            callback(null);
        });
}

app.get('/gem', function(req, res) {
    getGem((gem) => {
        if (gem)
            res.status(200).json(gem);
        else
            res.status(500).end();
    });
});

app.get('/listen/:r_hash', function(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    listeners[req.params.r_hash] = res;
});

function addInvoice(req, res, gem_id) {
    if (req.body.name.length > 50 || req.body.url && req.body.url.length > 50) {
        res.status(403).end();
        return;
    }
    lightning.addInvoice({
        value: req.body.value,
        memo: "Lightning Gem"
    }, meta, (err, response) => {
        if (err) {
            console.error(err);
            res.status(500).send(err);
        } else {
            response.r_hash = response.r_hash.toString('hex');
            const invoice = {
                gem_id: gem_id,
                name: req.body.name,
                url: req.body.url,
                r_hash: response.r_hash,
                value: req.body.value,
            };
            if (req.body.pay_req_out)
                invoice.pay_req_out = req.body.pay_req_out;
            db.collection('invoices').insertOne(invoice, (err) => {
                if (err)
                    res.status(500).send(err);
                else {
                    console.log("invoice added: " + JSON.stringify(invoice));
                    res.status(200).send(response);
                }
            });
        }
    });
}

app.post('/invoice', urlencodedParser, function(req, res) {
    if (!req.body.name) {
        res.status(400).end(); //this shouldn't happen, there's client-side validation to require a name
        return;
    }
    getGem(function(gem) {
        if (gem._id != req.body.gem_id) {
            res.status(400).send("Gem out of sync, try refreshing");
            return;
        }

        if (req.body.pay_req_out) {
            lightning.decodePayReq({
                pay_req: req.body.pay_req_out
            }, meta, (err, result) => {
                if (err) {
                    res.status(400).send("Could not decode payment request");
                } else if (result.num_satoshis != Math.round(gem.price * 1.25)) {
                    res.status(400).send("Invalid payment request value");
                } else if (result.expiry < 43200) {
                    res.status(400).send("Invalid payment request expiry");
                } else {
                    addInvoice(req, res, gem._id);
                }
            });
        } else {
            addInvoice(req, res, gem._id);
        }
    });
});

var invoiceSubscription = lightning.subscribeInvoices({}, meta);
invoiceSubscription.on('data', function(data) {
    if (data.settled) {
        const r_hash = data.r_hash.toString('hex');
        const invoiceQuery = {
            r_hash: r_hash
        };
        db.collection('invoices').findOne(invoiceQuery).then((invoice) => {
            if (invoice) {
                //make sure the gem is on the right id
                console.log("invoice settled: " + JSON.stringify(invoice));
                getGem(function(old_gem) {
                    let newVals = {
                        $set: {}
                    };
                    if (old_gem._id == invoice.gem_id) {
                        newVals.$set.status = 1;
                        let reset = false;

                        if (invoice.pay_req_out) {
                            db.collection('secrets').findOne({
                                _id: new Date().toISOString().split('T')[0]
                            }).then((secret) => {
                                const hash = crypto.createHash('sha256');
                                hash.update(invoice.pay_req_out + secret.secret);
                                const buf = hash.digest();
                                const firstByteInt = buf.readUIntBE(0, 1);
                                console.log('first byte of sha256 hash for ' + invoice.pay_req_out + secret.secret + ' is ' + firstByteInt);
                                if (firstByteInt < 8)
                                    reset = true;
                                insertGem(invoice, old_gem, r_hash, reset);
                            }).catch(console.error.bind(console));
                        } else {
                            insertGem(invoice, old_gem, r_hash, reset);
                        }
                    } else {
                        console.log("stale invoice paid");
                        sendEvent("stale", r_hash);
                        newVals.$set.status = 2;
                    }

                    db.collection('invoices').updateOne(invoiceQuery, newVals).catch((err) => {
                        console.error("error on invoice update: " + err);
                    });
                });
            }
        }).catch(console.error.bind(console));
    }
}).on('end', function() {
    console.log("subscribeInvoices ended");
}).on('status', function(status) {
    console.log("subscribeInvoices status: " + status);
}).on('error', function(error) {
    console.error("subscribeInvoices error: " + error);
});

function updateGem(gem_id, gem_update) {
    db.collection('gems').updateOne({
        _id: gem_id
    }, gem_update).catch(console.error.bind(console));
}

function insertGem(invoice, old_gem, r_hash, reset) {
    let new_gem = {
        _id: old_gem._id + 1,
        date: new Date().getTime()
    };
    if (reset) {
        new_gem.price = 100;
    } else {
        new_gem.price = Math.round(old_gem.price * 1.3);
        new_gem.owner = invoice.name;
        new_gem.url = invoice.url;
        new_gem.pay_req_out = invoice.pay_req_out;
    }

    db.collection('gems').insertOne(new_gem).then(() => {
        console.log('new gem: ' + JSON.stringify(new_gem));
        gem = new_gem;

        //update all payment requests waiting for server response
        if (reset)
            sendEvent("reset", r_hash);
        else
            sendEvent("settled", r_hash);
        for (const listener_r_hash in listeners) {
            if (listener_r_hash != r_hash) {
                sendEvent("expired", listener_r_hash);
            }
        }
        listeners = {};

        //update previous gem to mark it as bought and pay out previous owner 
        let gem_update = {
            $set: {
                bought: true
            }
        };
        if (reset)
            gem_update.$set.reset = true;
        if (old_gem.pay_req_out) {
            lightning.sendPaymentSync({
                payment_request: old_gem.pay_req_out
            }, meta, function(err) {
                if (!err) {
                    console.log("paid " + old_gem.pay_req_out);
                    gem_update.$set.paid_out = true;
                } else {
                    console.error(err);
                }
                updateGem(old_gem._id, gem_update);
            });
        } else {
            updateGem(old_gem._id, gem_update);
        }
    }).catch((err) => {
        console.error("error on new gem: " + err);
    });
}

function sendEvent(event, r_hash) {
    const listener = listeners[r_hash];
    if (listener && !listener.finished) {
        try {
            listener.write("data: " + event + "\n\n");
            //listeners[listener_r_hash].set("Connection", "close");
            listener.end();
        } catch (err) {
            console.error(err);
        }
    }
}