const express = require('express')
const app = express()
const bodyParser = require('body-parser');
const mysql = require('mysql')
const multer = require('multer')
const fs = require("fs");
const WavDecoder = require("wav-decoder");
var assert = require('assert');
const config = require('./config');

var connection = mysql.createConnection({
    host: config.DB_HOST,
    user: config.DB_USER,
    password: config.DB_PASS,
    database: config.DB_NAME
});
var upload = multer({dest: 'public/uploads/'})


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
                connection.query('INSERT INTO users VALUES(NULL,"' + req.body.fbId + '","' + req.body.email + '","' + req.body.username + '","",NULL);', function (err2, rows2, fields2) {
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


var saveFile = function (req, res, action) {
    if (req.file) {
        var fileDetail = req.file;
        if (action == "init") {
            const buffer = fs.readFileSync("./" + fileDetail.destination + "/" + fileDetail.filename);
            const decoded = WavDecoder.decode(buffer);
            var toneRate, tone = "-", fq;
            decoded.then(function (bufferDecoded) {
                const float32Array = bufferDecoded.channelData[0]; // get a single channel of sound
                fq = (bufferDecoded.sampleRate / (float32Array.sort()[float32Array.length - 1] - float32Array.sort()[0])) / 100
                console.log(fq);
                toneRate = {
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
                    + '","' + tone + '");', function (err2, results, fields2) {
                        if (err2) console.error(err2)
                        fileDetail.tone = tone;
                        fileDetail.id = results.insertId;
                        connection.query('UPDATE users SET gender = "' + req.body.gender + '", init_voice = "' + fileDetail.id + '" WHERE fb_id = "' + req.body.fbId + '";', function (err2, results, fields2) {
                                if (err2) console.error(err2)
                            }
                        )
                        return res.send(fileDetail)
                    }
                )
            })
        } else if (action == "chat") {
            connection.query('INSERT INTO files VALUES(NULL,"' +
                req.body.sender + '","'
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
                + '","");', function (err2, results, fields2) {
                    if (err2) console.error(err2)
                    fileDetail.id = results.insertId;
                    connection.query('UPDATE chats SET is_new = 0 WHERE sender = "' + req.body.sender + '" AND receiver = "' + req.body.receiver + '";', function (err2, results, fields2) {
                            if (err2) console.error(err2)
                            connection.query('INSERT INTO chats VALUES(NULL,' + req.body.sender + ',' + req.body.receiver + ',1,' + fileDetail.id + ',NULL);', function (err2, results, fields2) {
                                    if (err2) console.error(err2)
                                }
                            )
                        }
                    )

                    return res.send(fileDetail)
                }
            )
        }

    } else {
        res.send('Missing file');
    }
}

app.post('/api/voiceinit', upload.single('file'), function (req, res) {
    return saveFile(req, res, "init");
})

app.post('/api/find', function (req, res) {
    connection.query('SELECT * FROM users WHERE init_voice IS NOT NULL ', function (err, rows, fields) {
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
                        filepath = rows2[0].destination + "/" + rows2[0].filename;
                        res.set({'Content-Type': 'audio/wav'});
                        var readStream = fs.createReadStream(filepath);
                        readStream.pipe(res);
                    }
                )
                res.send(rows)
            }
        )
    } else {
        connection.query('SELECT * FROM chats WHERE sender = ' + req.body.sender + ' AND receiver = ' + req.body.receiver + ' ORDER BY id DESC LIMIT 0,1;', function (err, rows, fields) {
                if (err) console.error(err)
                connection.query('UPDATE chats SET is_new = 0 WHERE sender = "' + req.body.sender + '" AND receiver = "' + req.body.receiver + '";', function (err2, results, fields2) {
                        if (err2) console.error(err2)
                        connection.query('SELECT * FROM files WHERE id = ' + rows[0].file + ';', function (err2, rows2, fields2) {
                                if (err2) console.error(err2)
                                filepath = rows2[0].destination + "/" + rows2[0].filename;
                                res.set({'Content-Type': 'audio/wav'});
                                var readStream = fs.createReadStream(filepath);
                                readStream.pipe(res);
                            }
                        )
                    }
                )
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
    connection.query('SELECT receiver FROM chats WHERE sender = ' + req.body.fbId + ' GROUP BY receiver LIMIT 0,5;', function (err, rows, fields) {
            if (err) console.error(err)
            var fbId = [];
            rows.forEach(function (value, index) {
                fbId.push(value.receiver)
            })
            if (fbId.length == 0) {
                res.send([])
            } else {
                connection.query('SELECT * FROM users WHERE fb_id = ' + fbId.join(" OR fb_id = "), function (err2, rows2, fields2) {
                        if (err2) console.error(err2)
                        res.send(rows2)
                    }
                )
            }
        }
    )
})


app.use(express.static('public'))


app.listen(config.RUN_PORT, function () {
    console.log('Example app listening on port ' + config.RUN_PORT + '!')
})