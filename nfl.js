const request = require('request-promise');
const cheerio = require('cheerio');
const ical = require('ical-generator');
const moment = require('moment');
const AWS = require('aws-sdk');

const game_url_base = "http://www.espn.com/nfl/game/_/gameId/";
// const team_url_base = "http://www.espn.com/college-football/team/_/id/";

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
    return request('http://www.espn.com/nfl/schedule');
  },

  get_team_page: function (team_id) {
    return request(team_url_base + team_id);
  },

  find_team_games: function (html) {
    var $ = cheerio.load(html);
    return $("[data-module='schedule'] li a[rel='college-footballgamecast']").map(function (i, e) {
      var id = $(e).attr('href').match(/gameId\/(\d*)/)[1];
      return id;
    }).get();
  },

  find_games: function (html) {
    var $ = cheerio.load(html);
    return $(".schedule tbody tr").map(function (i, e) {
      var href = $(e).find('td').slice(2,3).find('a').attr('href');
      if(href == undefined)
      {
        return false;
      }
      var id = href.match(/gameId\/(\d*)/)[1];
      return id;
    }).get();
  },

  is_not_bye: function (id) {
    return id !== false;
  },

  get_game: function (game_id) {
    return request(game_url_base + game_id)
      .then(function (html) {
        var $game = cheerio.load(html);
        var network = $game('.game-details .game-network').text().trim();
        network = network.replace('Coverage: ', '');
        return {
          id: game_id,
          network: network,
          time: $game('.game-details .game-date-time [data-date]').data('date'),
          line: $game('.odds-details li').first().text().trim(),
          over_under: $game('.odds-details li.ou').text().trim(),
          home: {
            name: $game('.team.home .team-info-wrapper .long-name').text(),
            score: $game('.team.home .score').text().trim()
          },
          visitor: {
            name: $game('.team.away .team-info-wrapper .long-name').text(),
            score: $game('.team.away .score').text().trim()
          }
        };
      });
  },

  build_calendar: function (name, games) {
    console.log(games);
    var events = games.map(function (game) {
      var summary = String.fromCodePoint(127944) + " ";
      summary += game.visitor.name;
      summary += " at ";
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
        start: moment(game.time),
        end: moment(game.time).add(3.5, 'hour'),
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
      prodId: { company: 'hathaway.cc', product: 'nfl-football-calendar' },
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
  }
};

function build_weekly_calendar(name = 'NFL') {
  console.log("Building " + name);
  return schedule.get_weekly_schedule()
    .then(schedule.find_games)
    .filter(schedule.is_not_bye)
    .map(schedule.get_game)
    .then(function (games) {
      return schedule.build_calendar(name, games);
    })
    .then(function (calendar_data) {
      return schedule.put_in_s3(name, calendar_data);
    });
}

// function build_team_calendar(name = 'Notre Dame Football', team_id = 87) {
//   console.log("Building " + name);
//   return schedule.get_team_page(team_id)
//     .then(schedule.find_team_games)
//     .map(schedule.get_game)
//     .then(function (games) {
//       return schedule.build_calendar(name, games);
//     })
//     .then(function (calendar_data) {
//       return schedule.put_in_s3(name, calendar_data);
//     });
// }

exports.handler = (event, context, callback) => {
  console.log("Received event: ", event);

};

// For testing locally
build_weekly_calendar().then(function (result) {
  console.log("Success");
});
