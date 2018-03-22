var L = require('lokijs'); // There are starving kids in Africa who could use those characters!
var tr = require('./translations.json'); // This is probably poor encapsulation, huh?
var initalised = false;
var db;

var init = function (callback) {
  if (initalised) return;
  initalised = true;
  db = new L('./dmcdata.json');

  db.loadDatabase({}, function (err) {
    if (err) {
      callback(err);
    } else {
      var collections = ['questions', 'shallow-questions', 'channelInfo', 'userInfo'];
      for (var collection in collections) {
        createCollection(db, collections[collection]);
      }
      db.saveDatabase(function (err) {
        if (err) {
          callback(err);
        } else {
          console.log('Init worked, calling back.');
          callback();
        }
      });
    }
  });
};

function createCollection (db, name) {
  var collection = db.getCollection(name);
  if (!collection) {
    console.log('Creating collection ' + name);
    db.addCollection(name);
  }
}

exports.init = init;

exports.performDataUpgrade = function (channelId) {
  var thisChannelInfo = db.getCollection('channelInfo').findOne({'channel': channelId});
  thisChannelInfo.nextShallowQuestionToPostId = 1;
  thisChannelInfo.nextShallowQuestionToSaveId = 1;
  thisChannelInfo.isQuestionShallow = false;
  console.log('Upgrade performed for channel ' + channelId);
  db.saveDatabase();
};

exports.getChannelInfo = function (channelId, isCheck, callback) {
  var channelInfo = db.getCollection('channelInfo');
  var thisChannelInfo = channelInfo.findOne({'channel': channelId});
  if (!thisChannelInfo) {
    if (isCheck) {
      callback(null);
    } else {
      var newChannel = channelInfo.insert({
        'channel': channelId,
        'reactCount': 3,
        'downvoteId': '%E2%AC%87',
        'upvoteId': '%E2%AC%86',
        'questionOfTheDay': '', // I sure hope this works
        'nextQuestionToPostId': 1,
        'nextQuestionToSaveId': 1,
        'nextShallowQuestionToPostId': 1,
        'nextShallowQuestionToSaveId': 1,
        'isQuestionShallow': false
      });
      addQuestion(channelId, tr.aSimpleQ1, '<3', false, function () {
        db.saveDatabase(function (err) {
          if (err) {
            callback(err);
          } else {
            console.log('Channel created successfully!');
            callback(newChannel, true);
          }
        });
      });
    }
  } else {
    callback(thisChannelInfo, false);
  }
};

var addQuestion = function (channelId, question, author, shallow, callback) {
  var questions = shallow ? db.getCollection('shallow-questions') : db.getCollection('questions');
  var thisChannelInfo = db.getCollection('channelInfo').findOne({'channel': channelId});
  questions.insert({
    'channel': channelId,
    'question': question,
    'author': author,
    'questionId': shallow ? thisChannelInfo.nextShallowQuestionToSaveId++ : thisChannelInfo.nextQuestionToSaveId++
  });
  db.saveDatabase(function (err) {
    if (err) {
      callback(err);
    } else {
      console.log('Question saved successfully!');
      callback();
    }
  });
};

exports.addQuestion = addQuestion;

exports.getNextQuestion = function (channelId, check, callback, shouldFlip) {
  console.log('Getting question for ' + channelId + ', with check as ' + check + ' and shouldFlip as ' + shouldFlip);
  var thisChannelInfo = db.getCollection('channelInfo').findOne({'channel': channelId});
  var shallow = shouldFlip ? !thisChannelInfo.isQuestionShallow : thisChannelInfo.isQuestionShallow;
  var questions = shallow ? db.getCollection('shallow-questions') : db.getCollection('questions');
  var question = questions.findOne({'channel': channelId, 'questionId': shallow ? thisChannelInfo.nextShallowQuestionToPostId : thisChannelInfo.nextQuestionToPostId});
  if (!check && shouldFlip) { // Shouldn't really check and flip
    flipShallow(channelId);
  }
  if (question) {
    if (!check) {
      shallow ? thisChannelInfo.nextShallowQuestionToPostId++ : thisChannelInfo.nextQuestionToPostId++;
    }
    callback(question, shallow);
  } else {
    callback(null);
  }
};

exports.getQuestionMessageId = function (channelId) {
  return db.getCollection('channelInfo').findOne({'channel': channelId}).questionOfTheDay;
};

exports.setQuestionMessageId = function (channelId, messageId, callback) {
  var thisChannelInfo = db.getCollection('channelInfo').findOne({'channel': channelId});
  thisChannelInfo.questionOfTheDay = messageId;
  db.saveDatabase(function (err) {
    if (err) {
      callback(err);
    } else {
      console.log('Daily question saved!');
      callback(messageId);
    }
  });
};

exports.getUserInfo = function (userId, callback) {
  var users = db.getCollection('userInfo');
  var user = users.findOne({'user': userId});
  if (user) {
    callback(user, true);
  } else {
    return callback(users.insert({
      'user': userId,
      'knowsSecret': false
    }), false);
  }
};

exports.getAllChannels = function () {
  return db.getCollection('channelInfo').find().map(function (document) {
    return document.channel;
  });
};

exports.hasDailyQuestion = function (channelId) {
  return db.getCollection('channelInfo').findOne({'channel': channelId}).questionOfTheDay !== null;
};

exports.getAsked = function (channelId) {
  return db.getCollection('channelInfo').findOne({'channel': channelId}).asked;
};

exports.setAsked = function (channelId, value) {
  db.getCollection('channelInfo').findOne({'channel': channelId}).asked = value;
  db.saveDatabase();
};

exports.getVersionText = function (channelId) {
  return db.getCollection('channelInfo').findOne({'channel': channelId}).versionText;
};

exports.setVersionText = function (channelId, value) {
  db.getCollection('channelInfo').findOne({'channel': channelId}).versionText = value;
  db.saveDatabase();
};

exports.getIsShallow = function (channelId) {
  return db.getCollection('channelInfo').findOne({'channel': channelId}).isQuestionShallow;
};

var flipShallow = function (channelId) {
  var thisChannelInfo = db.getCollection('channelInfo').findOne({'channel': channelId});
  thisChannelInfo.isQuestionShallow = !thisChannelInfo.isQuestionShallow;
  db.saveDatabase();
};

exports.flipShallow = flipShallow;
