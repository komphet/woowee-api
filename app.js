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
                connection.query('INSERT INTO users VALUES(NULL,"' + req.body.fbId + '","' + req.body.email + '","' + req.body.username + '","");', function (err2, rows2, fields2) {
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


var saveFile = function(req,res){
    if (req.file) {
        var fileDetail = req.file;
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
                    return res.send(fileDetail)
                }
            )
        })
    } else {
        res.send('Missing file');
    }
}

app.post('/api/voiceinit', upload.single('file'), function (req, res) {
    return saveFile(req,res);
})


app.use(express.static('public'))


app.listen(config.RUN_PORT, function () {
    console.log('Example app listening on port '+config.RUN_PORT+'!')
})