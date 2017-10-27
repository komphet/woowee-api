const express = require('express')
const app = express()
const bodyParser = require('body-parser');
const mysql = require('mysql')
const multer = require('multer')
const fs = require("fs");
const WavDecoder = require("wav-decoder");
var assert = require('assert');
const config = require('./config');
import {Note, Pitcher} from 'pitch-detector';

var connection = mysql.createConnection({
    host: config.DB_HOST,
    user: config.DB_USER,
    password: config.DB_PASS,
    database: config.DB_NAME
});
var upload = multer({dest: 'public/uploads/'})

var MIN_SAMPLES = 0;  // will be initialized when AudioContext is created.
var GOOD_ENOUGH_CORRELATION = 0.9; // this is the "bar" for how close a correlation needs to be

var toneRate = {
    f: {
        h: [617, null],
        m: [387, 616],
        l: [null, 386]
    },
    m: {
        h: [465, null],
        m: [262, 464],
        l: [null, 261]
    },
};

connection.connect()
app.use(bodyParser.urlencoded({
    limit: '50mb',
    extended: true,
    parameterLimit: 1000000
}));
app.use(bodyParser.json({limit: '50mb'}));


app.post('/api/login', function (req, res) {
    connection.query('SELECT * FROM users WHERE fb_id LIKE "' + req.body.fbId +
        '"', function (err, rows, fields) {
            if (err) console.error(err)
            if (rows[0] == null) {
                connection.query('INSERT INTO users VALUES(NULL,"' + req.body.fbId + '","' + req.body.email + '","' + req.body.username + '","",NULL,NULL);', function (err2, rows2, fields2) {
                        if (err2) console.error(err2)
                        res.send(rows2)
                    }
                )
            } else {
                res.send(rows[0])
            }
        }
    )
})

function autoCorrelate(buf, sampleRate) {
    var SIZE = buf.length;
    if (SIZE > 100000) {
        SIZE = 100000;
    }
    console.log("size " + SIZE);
    var MAX_SAMPLES = Math.floor(SIZE / 2);
    var best_offset = -1;
    var best_correlation = 0;
    var rms = 0;
    var foundGoodCorrelation = false;
    var correlations = new Array(MAX_SAMPLES);

    for (var i = 0; i < SIZE; i++) {
        var val = buf[i];
        rms += val * val;
        // console.log(i, rms);
    }
    rms = Math.sqrt(rms / SIZE);
    // console.log(rms);
    if (rms < 0.01) // not enough signal
        return -1;

    var lastCorrelation = 1;
    for (var offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
        var correlation = 0;
        // console.log("Offset ", offset);

        for (var i = 0; i < MAX_SAMPLES; i++) {
            correlation += Math.abs((buf[i]) - (buf[i + offset]));
            // console.log("MAX_SAMPLES  ", i, correlation);

        }
        correlation = 1 - (correlation / MAX_SAMPLES);
        correlations[offset] = correlation; // store it, for the tweaking we need to do below.
        if ((correlation > GOOD_ENOUGH_CORRELATION) && (correlation > lastCorrelation)) {
            foundGoodCorrelation = true;
            if (correlation > best_correlation) {
                best_correlation = correlation;
                best_offset = offset;
            }
        } else if (foundGoodCorrelation) {
            // short-circuit - we found a good correlation, then a bad one, so we'd just be seeing copies from here.
            // Now we need to tweak the offset - by interpolating between the values to the left and right of the
            // best offset, and shifting it a bit.  This is complex, and HACKY in this code (happy to take PRs!) -
            // we need to do a curve fit on correlations[] around best_offset in order to better determine precise
            // (anti-aliased) offset.

            // we know best_offset >=1,
            // since foundGoodCorrelation cannot go to true until the second pass (offset=1), and
            // we can't drop into this clause until the following pass (else if).
            var shift = (correlations[best_offset + 1] - correlations[best_offset - 1]) / correlations[best_offset];
            return sampleRate / (best_offset + (8 * shift));
        }
        lastCorrelation = correlation;
    }
    if (best_correlation > 0.01) {
        // console.log("f = " + sampleRate/best_offset + "Hz (rms: " + rms + " confidence: " + best_correlation + ")")
        return sampleRate / best_offset;
    }
    return -1;
//	var best_frequency = sampleRate/best_offset;
}

var saveFile = function (req, res, action) {
    if (req.file) {
        var fileDetail = req.file;
        const buffer = fs.readFileSync("./" + fileDetail.destination + "/" + fileDetail.filename);
        const decoded = WavDecoder.decode(buffer);
        var tone = "-", fq;
        console.log("decoding...");
        decoded.then(function (bufferDecoded) {
            console.log("Calculating FQ");
            // console.log(bufferDecoded.channelData[0]);
            fq = Math.floor(autoCorrelate(bufferDecoded.channelData[0], bufferDecoded.sampleRate));
            console.log("FQ=" + fq);
            connection.query('SELECT * FROM setup WHERE slug = "TONE_RATE";', function (err, rows, fields) {
                if (rows.length != 0) {
                    toneRate = JSON.parse(rows[0].value);
                }
                console.log(toneRate);
                if (action == "init") {

                    var isSelectedTone = false;
                    Object.keys(toneRate[req.body.gender]).forEach(function (key) {
                        var hEst = toneRate[req.body.gender][key][1], lEst = toneRate[req.body.gender][key][0];
                        if (hEst != null && lEst != null && !isSelectedTone) {
                            if (fq <= hEst && fq >= lEst) {
                                tone = key;
                                isSelectedTone = true;
                            }
                        } else if (hEst != null && !isSelectedTone) {
                            if (fq <= hEst) {
                                tone = key;
                                isSelectedTone = true;
                            }
                        } else if (lEst != null && !isSelectedTone) {
                            if (fq >= lEst) {
                                tone = key;
                                isSelectedTone = true;
                            }
                        }

                    });
                }

                connection.query('INSERT INTO files VALUES(NULL,"' +
                    req.body.fbId + '","'
                    + fileDetail.fieldname
                    + '","'
                    + fileDetail.originalname
                    + '","'
                    + fileDetail.encoding
                    + '","'
                    + fileDetail.mimetype
                    + '","'
                    + fileDetail.destination
                    + '","'
                    + fileDetail.filename
                    + '","'
                    + fileDetail.path
                    + '","'
                    + fileDetail.size
                    + '","' + fq + '");', function (err2, results, fields2) {
                        if (err2) console.error(err2)
                        fileDetail.tone = tone;
                        fileDetail.fq = fq;
                        fileDetail.id = results.insertId;
                        if (action == "init") {
                            connection.query('UPDATE users SET gender = "' + req.body.gender + '", init_voice = "' + fileDetail.id + '", tone = "' + tone + '" WHERE fb_id = "' + req.body.fbId + '";', function (err2, results, fields2) {
                                    if (err2) console.error(err2)
                                }
                            )
                        } else if (action == "chat") {
                            connection.query('UPDATE chats SET is_new = 0 WHERE sender = "' + req.body.sender + '" AND receiver = "' + req.body.receiver + '";', function (err2, results, fields2) {
                                    if (err2) console.error(err2)
                                    connection.query('INSERT INTO chats VALUES(NULL,' + req.body.sender + ',' + req.body.receiver + ',1,' + fileDetail.id + ',NULL);', function (err2, results, fields2) {
                                            if (err2) console.error(err2)
                                        }
                                    )
                                }
                            )
                        }
                        return res.send(fileDetail)
                    }
                )
            })

        })
    }
    else {
        res.send('Missing file');
    }
}

app.post('/api/voiceinit', upload.single('file'), function (req, res) {
    return saveFile(req, res, "init");
})

app.post('/api/find', function (req, res) {
    connection.query('SELECT * FROM users WHERE init_voice IS NOT NULL AND gender = "' + req.body.gender + '" AND tone = "' + req.body.tone + '" ', function (err, rows, fields) {
            if (err) console.error(err)
            res.send(rows[Math.floor(Math.random() * rows.length)])
        }
    )
})

app.post('/api/setvoice', upload.single('file'), function (req, res) {
    return saveFile(req, res, "chat");
})

app.post('/api/getvoice', function (req, res) {
    if (req.body.receiver == null) {
        connection.query('SELECT * FROM users WHERE fb_id = ' + req.body.sender + ';', function (err, rows, fields) {
                if (err) console.error(err)
                connection.query('SELECT * FROM files WHERE id = ' + rows[0].init_voice + ';', function (err2, rows2, fields2) {
                        if (err2) console.error(err2)
                        if (rows2.length != 0) {
                            filepath = rows2[0].destination + "/" + rows2[0].filename;
                            res.set({'Content-Type': 'audio/wav'});
                            var readStream = fs.createReadStream(filepath);
                            readStream.pipe(res);
                        } else {
                            res.send(rows)
                        }
                    }
                )
            }
        )
    } else {
        var backstep = (typeof req.body.backstep != "undefined") ? req.body.backstep : 0;
        console.log(backstep);
        connection.query('SELECT * FROM chats WHERE sender = ' + req.body.sender + ' AND receiver = ' + req.body.receiver + ' ORDER BY id DESC LIMIT ' + backstep + ',1;', function (err, rows, fields) {
                if (err) console.error(err)
                if (rows.length == 0) {
                    res.send({"error": "No File"})
                } else {
                    if (backstep == 0) {
                        connection.query('UPDATE chats SET is_new = 0 WHERE sender = "' + req.body.sender + '" AND receiver = "' + req.body.receiver + '";', function (err2, results, fields2) {
                                if (err2) console.error(err2)
                                connection.query('SELECT * FROM files WHERE id = ' + rows[0].file + ';', function (err2, rows2, fields2) {
                                        if (err2) console.error(err2)
                                        if (rows2.length != 0) {
                                            var filepath = rows2[0].destination + rows2[0].filename;
                                            res.set({'Content-Type': 'audio/wav'});
                                            var readStream = fs.createReadStream(filepath);
                                            readStream.pipe(res);
                                        } else {
                                            res.send(JSON.parse({'error': 'No File'}))
                                        }
                                    }
                                )
                            }
                        )
                    } else {
                        connection.query('SELECT * FROM files WHERE id = ' + rows[0].file + ';', function (err2, rows2, fields2) {
                                if (err2) console.error(err2)

                                var filepath = rows2[0].destination + rows2[0].filename;
                                res.set({'Content-Type': 'audio/wav'});
                                var readStream = fs.createReadStream(filepath);
                                readStream.pipe(res);

                            }
                        )
                    }
                }
            }
        )
    }
})

app.post('/api/refresh', function (req, res) {
    connection.query('SELECT * FROM chats WHERE sender = ' + req.body.sender + ' AND receiver = ' + req.body.receiver + ' ORDER BY id DESC LIMIT 0,1;', function (err, rows, fields) {
            if (err) console.error(err)
            if (rows[0].is_new) {
                res.send(true)
            } else {
                res.send(false)
            }
        }
    )
})

app.post('/api/liked', function (req, res) {
    connection.query('SELECT receiver,sender FROM chats WHERE sender = ' + req.body.fbId + ' OR receiver = ' + req.body.fbId + ';', function (err, rows, fields) {
            if (err) console.error(err)
            var fbId = [];
            rows.forEach(function (value, index) {
                if (fbId.indexOf(value.receiver) == -1 && value.receiver != req.body.fbId) {
                    fbId.push(value.receiver)
                }
                if (fbId.indexOf(value.sender) == -1 && value.sender != req.body.fbId) {
                    fbId.push(value.sender)
                }
            })

            if (fbId.length == 0) {
                res.send([])
            } else {
                connection.query('SELECT * FROM users WHERE fb_id = ' + fbId.join(" OR fb_id = ") + " LIMIT 0,5;", function (err2, rows2, fields2) {
                        if (err2) console.error(err2)
                        res.send(rows2)
                    }
                )
            }
        }
    )
})

app.get('/api/tonerate', function (req, res) {
    connection.query('SELECT * FROM setup WHERE slug = "TONE_RATE";', function (err, rows, fields) {
        if (rows.length == 0) {
            res.send(JSON.stringify({value: toneRate}));
        } else {
            res.send(rows[0]);
        }
    })
})


app.use(express.static('public'))


app.listen(config.RUN_PORT, function () {
    console.log('Example app listening on port ' + config.RUN_PORT + '!')
})