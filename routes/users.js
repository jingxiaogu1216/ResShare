/**
 * Created by jingxiaogu on 12/2/15.
 */
var express = require('express');
var router = express.Router();
var User = require('../model/dbModel').user;
var Resume = require('../model/dbModel').resume;
var tokenAuth = require('../middleware/tokenAuth');
var awsconfig = require('../config/awsconfig');
var aws = require('aws-sdk');
var bcrypt = require('bcryptjs');
var elasticSearchClient = require('../model/dbModel').elsClient;



var ses = new aws.SES();
var sqs = new aws.SQS();

var emailParams = {
    Destination: {ToAddresses: []},
    Message: {Body: {Text: {Data: ''}}, Subject: {Data: ''}},
    Source: 'jingxiaogu1992@gmail.com'
};

var sendMail = function(emailParams) {
    ses.sendEmail(emailParams, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
    });
};

var sqsGetParams = {
    QueueName: ""
};



/****************************** News Page ***********************************/

router.get('/', function (req, res, next) {
    res.render('user');
});

router.get('/data', tokenAuth.requireToken, function (req, res, next) {
    if (req.user.interested_field.length == 0) {
        Resume.find({status: 1}, function(err, resume) {
            resume = resume.reverse().splice(0, 21);
            var data = {"user": req.user, "resume": resume};
            res.send(data);
        })
    }
    else {
        Resume.find({status: 1, tag: {$in: req.user.interested_field}}, function (err, resume) {
            resume = resume.reverse().splice(0, 21);
            var data = {"user": req.user, "resume": resume};
            res.send(data);
        });
    }
});

//search
//url: /user/search/?kw=xxx
router.post('/search', function(req, res, next) {
    //Resume.find({$text: {$search: req.query.kw}}, {score: {$meta: "textScore"}}).sort({score: {$meta: "textScore"}})
    //    .exec(function (err, data) {
    //        res.send(data);
    //    });
    elasticSearchClient.search({
        index: 'reshare',
        body: {
            query: {
                multi_match: {
                    query: req.query.kw,
                    fields: ['subject', 'content','tag', 'username'],
                    operator: 'or',
                    fuzziness: 'AUTO'
                }
            }
        }
    }, function (error, response) {
        var array = [];
        for (var i = 0; i < response.hits.hits.length; i++) {
            array[i] = response.hits.hits[i]._source;
        }
        res.send(array);
    });
});



/*************************** User Profile Page ******************************/

router.get('/profile/:uid/info', function(req, res, next) {
    res.render('profile_info', {uid: req.params.uid});
});

router.get('/profile/:uid/admin', function (req, res, next) {
    res.render('profile_admin', {uid: req.params.uid});
});

router.get('/profile/:uid/topic', function (req, res, next) {
    res.render('profile_topic', {uid: req.params.uid});
});

router.get('/profile/:uid/notification', function (req, res, next) {
    res.render('profile_notification', {uid: req.params.uid});
});

router.get('/profile/:uid/data', tokenAuth.requireToken, function (req, res, next) {
    if (req.user.uid == req.params.uid) {
        res.send({user: req.user, self:true});
    }
    else {
        User.findOne({uid: req.params.uid}, function (err, user) {
            if (err) throw err;
            res.send({user: user, self:false});
        });
    }
});


//user has logged in and want to reset password
router.post('/profile/password/edit', tokenAuth.requireToken, function (req, res, next) {
    if (req.body.password != req.body.confirm_password) {
        res.send("passwords don't match, please try again");
        return;
    }
    var hash = bcrypt.hashSync(req.body.password, bcrypt.genSaltSync(10));
    User.update({uid: req.user.uid}, {password: hash}, function (err, result) {
        if (err) {
            res.send("internal err");
        }
        else {
            res.send("Your password has been successfully reset");
            emailParams.Message.Subject.Data = 'Your password has been changed';
            emailParams.Destination.ToAddresses.push(req.body.email);
            emailParams.Message.Body.Text.Data = 'Hello,\n\n' +
                'This is a confirmation that the password for your account ' + req.body.email + ' has just been changed.\n';
            sendMail(emailParams);
        }
    });
});


router.post('/profile/info/edit', tokenAuth.requireToken, function (req, res, next) {
    User.update({uid: req.user.uid}, {$set: JSON.parse(req.body.user)}, function (err, data) {
        if (err) throw err;
        if (req.user.username != JSON.parse(req.body.user).username) {
            Resume.update({uid: req.user.uid},{username: JSON.parse(req.body.user).username}, {multi: true}, function (err, data) {
                if (err) throw err;
                if (data.n == 0) {
                    res.send('success');
                    return;
                }
                Resume.find({uid: req.user.uid}, function (err, resumeArray) {
                    if (err) throw err;
                    for (var i = 0; i < resumeArray.length; i++) {
                        elasticSearchClient.update({
                            index: 'reshare',
                            type: 'resume',
                            id: resumeArray[i].rid,
                            body: {
                                doc: {
                                    username: JSON.parse(req.body.user).username
                                }
                            }},function(err, res) {
                            if (err) throw err;
                        });
                    }
                });
            });
        }
        if (req.user.avatar != JSON.parse(req.body.user).avatar) {
            Resume.update({uid: req.user.uid}, {avatar: JSON.parse(req.body.user).avatar}, {multi: true}, function (err, data) {
                if (err) throw err;
                if (data.n == 0) {
                    res.send('success');
                    return;
                }
                Resume.find({uid: req.user.uid}, function (err, resumeArray) {
                    for (var i = 0; i < resumeArray.length; i++) {
                        elasticSearchClient.update({
                            index: 'reshare',
                            type: 'resume',
                            id: resumeArray[i].rid,
                            body: {
                                doc: {
                                    avatar: JSON.parse(req.body.user).avatar
                                }
                            }},function(err, res) {
                            if (err) throw err;
                        });
                    }
                });
            });
        }
    });
});


router.get('/profile/:uid/topic/data', tokenAuth.requireToken, function(req, res, next) {
    Resume.find({uid: req.params.uid}, function (err, data) {
        if (err) throw err;
        res.send(data);
    });
});


router.get('/profile/:uid/notification/data', tokenAuth.requireToken, function(req, res, next) {
    var message = [];
    sqsGetParams.QueueName = req.params.uid;
    sqsGetParams.QueueName = req.params.uid;
    var sqsRecieveParams = {
        QueueUrl: ''
    };
    sqs.getQueueUrl(sqsGetParams, function(err, data) {
        if (err) throw err;
        sqsRecieveParams.QueueUrl = data.QueueUrl;
        var params = {
            QueueUrl: data.QueueUrl,
            AttributeNames: ['ApproximateNumberOfMessages']
        };
        sqs.getQueueAttributes(params, function(err, data) {
            if (err) throw err;
            var num = data.Attributes.ApproximateNumberOfMessages;
            check(message);
            for (var i = 0; i < num; i++) {
                sqs.receiveMessage(sqsRecieveParams, function(err, data) {
                    message.push(data.Messages);
                    check(message)
                });
            }
            function check(message){

                if (message.length >= num) {
                    res.send(message)
                }
            }
        });
    });
});

router.post('/profile/:uid/notification/check', tokenAuth.requireToken, function(req, res, next) {
    var sqsDeleteParams = {
        QueueUrl: '',
        ReceiptHandle: req.body.receiptHandle
    };
    sqsGetParams.QueueName = req.params.uid;
    sqs.getQueueUrl(sqsGetParams, function(err, data) {
        if (err) throw err;
        sqsDeleteParams.QueueUrl = data.QueueUrl;
        sqs.deleteMessage(sqsDeleteParams, function(err, data) {
            if (err) throw err;
            res.send({"success": true});
        });
    });
});



/********************************* User Resume Page ******************************/

router.get('/profile/:uid/resume', function (req, res, next) {
    res.render('user_resume', {uid: req.params.uid});
});

router.get('/resume/data', tokenAuth.requireToken, function (req, res, next) {
    Resume.find({uid: req.user.uid}, function (err, data) {
        res.send(data);
    });
});

//upload a resume
router.post('/resume/upload', tokenAuth.requireToken, function(req, res, next) {
    var record = new Resume({
        uid: req.user.uid,
        username: req.user.username,
        avatar: req.user.avatar,
        rid: req.body.rid,
        resumename: req.body.resumename,
        url: req.body.url,
        link: '',
        subject: '',
        content: '',
        tag: JSON.parse(req.body.tag),
        status: 0,
        comments:[]
    });
    record.save(function (err) {
        if (err) throw err;
        else res.send('success');
    });
});

router.get('/resume/aws/data', tokenAuth.requireToken, function (req, res, next) {
    res.send(awsconfig);
});

//delete a resume
router.post('/resume/delete', tokenAuth.requireToken, function (req, res, next) {
    Resume.remove({rid: req.body.rid}, function (err, res) {
        if (err) throw err;
        if (req.body.status == 1) {
            elasticSearchClient.delete({
                index: 'reshare',
                type: 'resume',
                id: req.body.rid
            }, function (error, response) {
                if (error) throw error
                else res.send('success');
            });
        }
    });
});

//share resume
router.post('/resume/share', tokenAuth.requireToken, function (req, res, next) {
    var link = req.headers.host + "/resume/" + req.body.rid;
    Resume.update({rid: req.body.rid}, {$set: {
        link: link,
        subject: req.body.subject,
        content: req.body.content,
        status: 1
    }}, function (err) {
        if (err) throw err;
        Resume.findOne({rid: req.body.rid}, function (err, resume) {
            resume._id = undefined;
            elasticSearchClient.create({
                index: 'reshare',
                type: 'resume',
                id: req.body.rid,
                body: resume
            }, function (err, res) {
                if (err) throw err;
                else res.send('success');
            });
        });
    });
});


module.exports = router;