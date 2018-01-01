var fs = require('fs');
var cron = require('node-cron');
var express = require('express');
var app = express();
var tr = require('./translations.json');
var pers = require('./mfwbotcrashes.js');
var Discord = require('discord.js');
var bot = new Discord.Client({autoReconnect: true});

bot.login(process.env.TOKEN);

pers.init(function (err) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  var channelsCron = pers.getAllChannels();
  for (var channel in channelsCron) {
    cron.schedule('0 2 * * *', function () {
      postNewMessage(bot.channels.get(channelsCron[channel]));
    });
  }

  bot.on('ready', function (event) {
    console.log('Logged in as %s - %s\n', bot.user.username, bot.user.id);
    fs.readFile('README.md', 'utf8', function (err, data) {
      if (err) throw err;
      var channels = pers.getAllChannels();
      for (var channel in channels) {
        var releaseNoteRegx = /(__\*\*.*\*\*__[^_]*)__\*\*/g;
        bot.channels.get(channels[channel]).send(tr.whatHappened + releaseNoteRegx.exec(data)[1]);
      }
    });
  });

  bot.on('messageReactionAdd', function (messageReaction) {
    handleReaction(messageReaction);
  });

  bot.on('messageReactionRemove', function (messageReaction) {
    handleReaction(messageReaction);
  });

  function handleReaction (messageReaction) {
    var message = messageReaction.message;
    var channelId = message.channel.id;
    pers.getChannelInfo(channelId, true, function (channelInfo) {
      if (channelInfo !== null) {
        if (message.author.id === bot.user.id && pers.getQuestionMessageId(channelId) === message.id) {
          if (pers.getAsked(channelId)) {
            if (messageReaction.emoji.identifier === channelInfo.upvoteId && messageReaction.count === channelInfo.reactCount + 1) {
              postNewMessage(message.channel);
            }
          } else {
            var diff = message.reactions.reduce(function (val, curr) {
              if (curr.emoji.identifier === channelInfo.upvoteId) {
                val -= curr.count;
              } else if (curr.emoji.identifier === channelInfo.downvoteId) {
                val += curr.count;
              }
              return val;
            }, 0);
            if (diff === channelInfo.reactCount) {
              postNewMessage(message.channel);
            }
          }
        }
      }
    });
  }

  bot.on('message', function (message) {
    if (!message.author.bot) {
      console.log(message.author.username + ' - ' + message.author.id + ' - ' + message.channel.id + ' - ' + message.content);
      if (message.channel instanceof Discord.DMChannel) {
        setTimeout(function () { // I am never using setTimeout again in my life
          message.channel.startTyping();
          setTimeout(function () {
            pers.getUserInfo(message.author.id, function (userInfo, wasThere) {
              var questionRegx = /".*?"/g;
              var toSave;
              var found = 0;
              while ((toSave = questionRegx.exec(message.content)) !== null) {
                found++;
                var channels = pers.getAllChannels();
                for (var channel in channels) {
                  pers.addQuestion(channels[channel], toSave[0].slice(1, -1), message.author.id, function () {});
                }
                console.log(toSave[0]);
              }
              if (found === 0) {
                if (!wasThere) {
                  message.channel.send(tr.greetingsUser);
                } else if (!userInfo.knowsSecret) {
                  message.channel.send(tr.sadbois).then(function () {
                    message.channel.startTyping();
                    setTimeout(function () {
                      message.channel.send(tr.sadbois2);
                      userInfo.knowsSecret = true;
                      message.channel.stopTyping();
                    }, 5000);
                  });
                } else {
                  message.channel.send('...  :3');
                }
              } else {
                if (found > 1) {
                  message.channel.send(tr.questRec2);
                } else {
                  message.channel.send(tr.questRec);
                }
                for (var toCheck in channels) {
                  if (!pers.hasDailyQuestion(channels[toCheck])) {
                    bot.channels.get(channels[channel]).send(tr.aNewQ).then(function (message) {
                      pers.getChannelInfo(channels[channel], true, function (channelInfo) {
                        message.react(channelInfo.upvoteId);
                        pers.setQuestionMessageId(message.channel.id, message.id, function () {});
                        pers.setAsked(channels[channel], true);
                      });
                    });
                  }
                }
              }
            });
          }, 2000);
          message.channel.stopTyping();
        }, 500);
        return;
      }
      if (message.content === tr.introduceYourself) {
        message.channel.send(tr.dontPurge).then(function () {
          postNewMessage(message.channel);
        });
      }
    }
  });

  function postNewMessage (channel) {
    pers.getChannelInfo(channel.id, false, function (channelInfo, isNewChannel) {
      if (isNewChannel) {
        cron.schedule('0 2 * * *', function () {
          postNewMessage(bot.channels.get(channel.id));
        });
      }
      if (channelInfo.questionOfTheDay !== null) {
        channel.fetchMessage(channelInfo.questionOfTheDay).then(function (message) {
          if (message.pinned) {
            message.unpin();
          }
        });
      }
      pers.getNextQuestion(channel.id, function (question) {
        if (question === null) {
          channel.send(tr.allOut).then(function (message) {
            pers.setQuestionMessageId(message.channel.id, null, function () {});
          });
        } else {
          channel.send('***Today\'s question is: ***' + question.question).then(function (message) {
            message.react(channelInfo.upvoteId);
            message.react(channelInfo.downvoteId);
            message.pin();
            pers.setQuestionMessageId(message.channel.id, message.id, function () {});
            pers.setAsked(message.channel.id, false);
          });
        }
      });
    });
  }

  /*
  CURRENTLY UNUSED, DON'T LOSE THIS THOUGH
  function deletThis (channel) {
    return channel.fetchMessages({limit: 100}).then(function (messages) {
      messages = messages.filter(function (ele) {
        return !(ele.content === tr.dontPurge && ele.author.id === bot.user.id);
      });
      var toDelete = messages.array().length;
      if (toDelete !== 0) {
        console.log('I\'ve got ' + toDelete + ' messages! Wow!');
        if (toDelete === 1) {
          postNewMessage(channel);
          return messages.first().delete();
        }
        return channel.bulkDelete(messages).then(function () {
          console.log('Going again!');
          deletThis(channel);
        });
      } else {
        postNewMessage(channel);
      }
    });
  }
  */
});

app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));

app.get('/', function (request, response) {
  response.send('Hello World!');
});

app.listen(app.get('port'), function () {
  console.log('Node app is running at localhost:' + app.get('port'));
});
