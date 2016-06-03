var Stremio = require("stremio-addons");
var needle = require("needle");
var _ = require("lodash");

var twitch_chans = [];

var stremioCentral = "http://api9.strem.io";

var pkg = require("./package");
var manifest = { 
    "id": "org.stremio.twitch",
    "types": ["tv"],
    "filter": { "query.twitch_id": { "$exists": true }, "query.type": { "$in":["tv"] } },
    icon: "http://s.jtvnw.net/jtv_user_pictures/hosted_images/GlitchIcon_purple.png",
    logo: "https://rack1.chipmeup.com/assets/twitch/logo-cd148048b88ce417a0c815548e7e4681.png",
    repository: "http://github.com/jaruba/stremio-twitch",
    endpoint: "http://twitch.strem.io/stremioget/stremio/v1",
    name: pkg.displayName, version: pkg.version, description: pkg.description,
    isFree: true,
    sorts: [{prop: "popularities.twitch", name: "Twitch.tv", types:["tv"]}],
    boardShowControls: true
};

var expire = [];

// Get all channels
function twitchStreams(cb, limit, offset) {

    if (expire[offset] && expire[offset] > Date.now()) {
        if (twitch_chans[offset] && twitch_chans[offset].length && cb) {
            cb(null, twitch_chans[offset]);
            return;
        }
    }

    needle.get('https://api.twitch.tv/kraken/streams?limit=' + (limit || 75) + '\u0026offset=' + (offset || 0), function(err, res) {
        if (err) {
            cb && cb(err);
            return;
        }
        twitch_chans[offset] = [];
        if (res && res.body && res.body.streams && res.body.streams.length) {
            var channel = res.body.streams[0].channel.name;
            res.body.streams.forEach( function(el, ij) {
                twitch_chans[offset].push({
                    id: 'twitch_id:' + el.channel.name,
                    name: el.channel.status,
                    poster: el.preview.medium,
                    posterShape: 'landscape',
                    logoShape: 'hidden',
                    banner: el.channel.video_banner || el.preview.template.replace('{width}', '1920').replace('{height}', '1080'),
                    genre: [ 'Entertainment' ],
                    isFree: 1,
                    popularity: el.viewers,
                    popularities: { twitch: el.viewers },
                    type: 'tv'
                });
            });
            expire[offset] = Date.now() + 1800000; // expire in 30 mins
            cb && cb(null, twitch_chans[offset]);
        } else if (cb)
            cb(new Error('Network Error'));
    });
}

function searchMeta(args, cb) {

    var searcher = encodeURIComponent(args.query).split('%20').join('+');

    needle.get('https://api.twitch.tv/kraken/search/streams?limit=' + (args.limit || 75) + '&offset=' + (args.skip || 0) + '&q=' + searcher, function(err, res) {
        if (err) {
            cb && cb(err);
            return;
        }
        var results = [];
        if (res && res.body && res.body.streams && res.body.streams.length) {
            var channel = res.body.streams[0].channel.name;
            res.body.streams.forEach( function(el, ij) {
                results.push({
                    id: 'twitch_id:' + el.channel.name,
                    name: el.channel.status,
                    poster: el.preview.medium,
                    posterShape: 'landscape',
                    backgroundShape: 'contain',
                    logoShape: 'hidden',
                    banner: el.preview.template.replace('{width}', '1920').replace('{height}', '1080'),
                    genre: [ 'Entertainment' ],
                    isFree: 1,
                    popularity: el.viewers,
                    popularities: { twitch: el.viewers },
                    type: 'tv'
                });
            });
            cb && cb(null, { results: results, query: args.query });
        } else if (cb)
            cb(new Error('Network Error'));
    });
}

function getStream(args, callback) {
    var channel = args.query.twitch_id;
    if (channel) {
        needle.get('http://api.twitch.tv/api/channels/' + channel + '/access_token', function(err, res) {
            if (err) {
                callback(err);
                return;
            }
            if (res && res.body && res.body.sig && res.body.token) {
                var title = res.body.status;
                var token = res.body.token;
                var sig = res.body.sig;
                var rand = Math.floor((Math.random() * 999999) + 1);
                var mrl = 'http://usher.twitch.tv/api/channel/hls/' + channel + '.m3u8?player=twitchweb&token=' + token + '&sig=' + sig + '&allow_audio_only=true&allow_source=true&type=any&p=' + rand;
                callback(null, [{
                    availability: 1,
                    url: mrl,
                    title: 'HD',
                    tag: ['hls'],
                    isFree: 1,
                    twitch_id: args.query.twitch_id
                }]);
            } else if (callback)
                callback(new Error('Network Error'));
        });
    } else
        callback(new Error('Stream Missing'))
}

function getMeta(args, callback) {
    var offset = args.skip || 0;
    var limit = args.limit || 75;
    if (args.query.twitch_id) {
        var found = twitch_chans.some( function(chans) {
            return chans.some( function(el) {
                if (el.id == 'twitch_id:' + args.query.twitch_id) {
                    callback(null, el);
                    return true;
                }
            });
        });
        if (!found) {
            needle.get('http://api.twitch.tv/api/channels/' + args.query.twitch_id, function(err, res) {
                if (err) {
                    callback(err);
                    return;
                }
                if (res && res.body) {
                    callback(null, {
                        id: 'twitch_id:' + args.query.twitch_id,
                        name: res.body.status,
                        poster: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' + args.query.twitch_id + '-320x180.jpg',
                        posterShape: 'landscape',
                        backgroundShape: 'contain',
                        logoShape: 'hidden',
                        banner: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' + args.query.twitch_id + '-1920x1080.jpg',
                        genre: [ 'Entertainment' ],
                        isFree: 1,
                        type: 'tv'
                    });
                } else if (callback)
                    callback(new Error('No Results'));
            });
        }
    } else {
        twitchStreams(function(err, chans) {
            if (err) callback(err);
            else {
                callback(null, args.limit ? chans.slice(0, args.limit) : chans);
            }
        }, limit, offset);
    }
}
var addon = new Stremio.Server({
    "stream.find": getStream,
    "meta.get": getMeta,
    "meta.search": searchMeta,
    "meta.find": getMeta
}, { stremioget: true, cacheTTL: { "meta.find": 30*60, "stream.find": 19*60, "meta.get": 4*60*60 }, allow: ["http://api8.herokuapp.com","http://api9.strem.io"] /* secret: mySecret */ }, manifest);

var server = require("http").createServer(function (req, res) {
    addon.middleware(req, res, function() { res.end() }); // wire the middleware - also compatible with connect / express
}).on("listening", function()
{
    console.log("Twitch.tv Stremio Addon listening on "+server.address().port);
})
if (module.parent) module.exports = server;
else server.listen(process.env.PORT || 9028);

var catchMyExceptions = require('catch-my-exceptions');
if (process.env.SLACK_HOOK) catchMyExceptions(process.env.SLACK_HOOK, { slackUsername: "twitch" });
