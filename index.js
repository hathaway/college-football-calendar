const request = require('request-promise');
const cheerio = require('cheerio');
const ical = require('ical-generator');
const moment = require('moment');
const AWS = require('aws-sdk');
const pretty = require("pretty");

const game_url_base = "https://www.espn.com/college-football/game/_/gameId/";
const team_url_base = "https://www.espn.com/college-football/team/_/id/";

// var credentials = new AWS.SharedIniFileCredentials({ profile: 'hathaway' });
// AWS.config.credentials = credentials;

var schedule = {
  slugify: function (text){
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with -
      .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
      .replace(/\-\-+/g, '-')         // Replace multiple - with single -
      .replace(/^-+/, '')             // Trim - from start of text
      .replace(/-+$/, '');            // Trim - from end of text
  },

  get_weekly_schedule: function () {
    return request('https://www.espn.com/college-football/schedule');
  },

  get_team_page: function (team_id) {
    return request(team_url_base + team_id);
  },

  find_team_games: function (html) {
    var $ = cheerio.load(html);
    return $("a.Schedule__Game").map(function (i, e) {
      var id = $(e).attr('href').match(/gameId\/(\d*)/)[1];
      return id;
    }).get();
  },

  find_games: function (html) {
    var $ = cheerio.load(html);
    return $('td.date__col').map(function (i, e) {
      var id = $(e).find('a').attr('href').match(/gameId\/(\d*)/)[1];
      return id;
    }).get();
  },

  get_game: function (game_id) {
    console.log("Getting game " + game_url_base + game_id);
    return request(game_url_base + game_id)
      .then(function (html) {
        var $game = cheerio.load(html);
        var time = $game('.GameInfo__Meta').find('span').slice(0,1).text().trim();
        var network = $game('.GameInfo__Meta').find('span').slice(1,2).text().trim();
        network = network.replace('Coverage: ', '');
        var $away_team = $game('.Gamestrip__TeamContent').slice(0,1);
        var $home_team = $game('.Gamestrip__TeamContent').slice(1,2);
        return {
          id: game_id,
          network: network,
          time: time,
          line: $game('.GameInfo__BettingItem.line').text().trim(),
          over_under: $game('.GameInfo__BettingItem.ou').text().trim(),
          home: {
            name: $home_team.find('.ScoreCell__TeamName').text().trim(),
            rank: $home_team.find('.ScoreCell__Rank').text().trim(),
            score: $home_team.find('.Gamestrip__Score .score').text().trim()
          },
          visitor: {
            name: $away_team.find('.ScoreCell__TeamName').text().trim(),
            rank: $away_team.find('.ScoreCell__Rank').text().trim(),
            score: $away_team.find('.Gamestrip__Score .score').text().trim()
          }
        };
      });
  },

  build_calendar: function (name, games) {
    console.log(games);
    var events = games.map(function (game) {
      var summary = String.fromCodePoint(127944) + " ";
      if (game.visitor.rank !== '') {
        summary += "#" + game.visitor.rank + " ";
      }
      summary += game.visitor.name;

      summary += " at ";
      if (game.home.rank !== '') {
        summary += "#" + game.home.rank + " ";
      }
      summary += game.home.name;

      var description = '';
      if (game.line !== '') {
        description += game.line + "\n";
      }
      if (game.over_under !== '') {
        description += game.over_under + "\n";
      }

      var location = '';
      if (game.visitor.score !== '' || game.home.score !== '') {
          location = 'FINAL: ' +
            game.visitor.name + ' ' + game.visitor.score +
            ', ' +
            game.home.name + ' ' + game.home.score;
      }
      else {
        if (game.network !== '') {
          location = 'Watch on ' + game.network;
        }
      }

      return {
        start: moment(Date.parse(game.time)).add(4, 'hour'),
        end: moment(Date.parse(game.time)).add(4, 'hour').add(3.5, 'hour'),
        timestamp: moment(),
        summary: summary,
        location: location,
        url: game_url_base + game.id,
        description: description
      };
    });

    var calendar = ical({
      name: name,
      url: 'https://hathaway.cc/calendars/' + schedule.slugify(name),
      domain: 'hathaway.cc',
      prodId: { company: 'hathaway.cc', product: 'college-football-calendar' },
      events: events,
      ttl: 60 * 60 * 24
    }).toString();
    // console.log(calendar);
    return calendar;
  },

  put_in_s3: function (name, calendar_data) {
    var s3 = new AWS.S3();
    var params = {
      Bucket: 'hathaway.cc',
      Key: 'calendars/' + schedule.slugify(name) + '.ics',
      Body: calendar_data
    };
    return s3.putObject(params, function (err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else console.log(data);           // successful response
    });
  },

  is_top_25_matchup: function (game) {
    return game.visitor.rank != '' && game.home.rank != '';
  },

  is_top_25: function (game) {
    return game.visitor.rank != '' || game.home.rank != '';
  }
};

function build_top_25_calendar(name = 'College Football Top 25') {
  console.log("Building " + name);
  return schedule.get_weekly_schedule()
    .then(schedule.find_games)
    .map(schedule.get_game)
    .filter(schedule.is_top_25)
    .then(function (games) {
      return schedule.build_calendar(name, games);
    })
    .then(function (calendar_data) {
      return schedule.put_in_s3(name, calendar_data);
    });
}

function build_top_25_matchup_calendar(name = 'College Football Top 25 Matchups') {
  console.log("Building " + name);
  return schedule.get_weekly_schedule()
    .then(schedule.find_games)
    .map(schedule.get_game)
    .filter(schedule.is_top_25_matchup)
    .then(function (games) {
      return schedule.build_calendar(name, games);
    })
    .then(function (calendar_data) {
      return schedule.put_in_s3(name, calendar_data);
    });
}

function build_team_calendar(name = 'Notre Dame Football', team_id = 87) {
  console.log("Building " + name);
  return schedule.get_team_page(team_id)
    .then(schedule.find_team_games)
    .map(schedule.get_game)
    .then(function (games) {
      return schedule.build_calendar(name, games);
    })
    .then(function (calendar_data) {
      return schedule.put_in_s3(name, calendar_data);
    });
}

exports.handler = (event, context, callback) => {
  console.log("Received event: ", event);
  build_top_25_calendar().then(function (result) {
    build_top_25_matchup_calendar().then(function (result) {
      build_team_calendar().then(function (result) {
        build_team_calendar('Ohio State Football', 194).then(function (result) {
          callback(null, 'Success');
        });
      });
    });
  });
};



// For testing locally
build_top_25_calendar().then(function (result) {
  build_top_25_matchup_calendar().then(function (result) {
    build_team_calendar().then(function (result) {
      build_team_calendar('Ohio State Football', 194).then(function (result) {
        build_team_calendar('Oklahoma Football', 201).then(function (result) {
          console.log("Success");
        });
      });
    });
  });
});
