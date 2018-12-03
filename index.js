const addonSDK = require('stremio-addon-sdk')
const needle = require('needle')
const _ = require('lodash')

const twitch_head = { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID } }

const twitch_chans = []

const pkg = require("./package");
const addon = new addonSDK({
    id: 'org.stremio.twitch',
    version: pkg.version,
    name: pkg.displayName,
    description: pkg.description,
    icon: 'http://s.jtvnw.net/jtv_user_pictures/hosted_images/GlitchIcon_purple.png',
    logo: 'https://rack1.chipmeup.com/assets/twitch/logo-cd148048b88ce417a0c815548e7e4681.png',
    resources: ['stream', 'meta', 'catalog'],
    types: ['tv'],
    idPrefixes: ['twitch_id:'],
    catalogs: [
        {
            type: 'tv',
            id: 'twitch_catalog',
            extraSupported: ['search']
        }
    ]
})

var expire = [];

// Get all channels
const twitchStreams = (cb, limit, offset) => {

    if (expire[offset] && expire[offset] > Date.now()) {
        if (twitch_chans[offset] && twitch_chans[offset].length && cb) {
            cb(null, twitch_chans[offset]);
            return;
        }
    }

    needle.get('https://api.twitch.tv/kraken/streams?limit=' + (limit || 75) + '\u0026offset=' + (offset || 0), twitch_head, function(err, res) {
        if (err) {
            cb && cb(err);
            return;
        }
        twitch_chans[offset] = [];
        if (res && res.body && res.body.streams && res.body.streams.length) {
            const channel = res.body.streams[0].channel.name;
            res.body.streams.forEach( function(el, ij) {
                twitch_chans[offset].push({
                    id: 'twitch_id:' + el.channel.name,
                    name: el.channel.status,
                    poster: el.preview.medium,
                    posterShape: 'landscape',
                    logoShape: 'hidden',
                    background: el.channel.video_banner || el.preview.template.replace('{width}', '1920').replace('{height}', '1080'),
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

    var searcher = encodeURIComponent(args.extra.search).split('%20').join('+');

    needle.get('https://api.twitch.tv/kraken/search/streams?limit=' + (args.extra.limit || 75) + '&offset=' + (args.extra.skip || 0) + '&q=' + searcher, twitch_head, function(err, res) {
        if (err) {
            cb && cb(err);
            return;
        }
        const results = [];
        if (res && res.body && res.body.streams && res.body.streams.length) {
            const channel = res.body.streams[0].channel.name;
            res.body.streams.forEach( (el, ij) => {
                results.push({
                    id: 'twitch_id:' + el.channel.name,
                    name: el.channel.status,
                    poster: el.preview.medium,
                    posterShape: 'landscape',
                    backgroundShape: 'contain',
                    logoShape: 'hidden',
                    background: el.preview.template.replace('{width}', '1920').replace('{height}', '1080'),
                    genre: [ 'Entertainment' ],
                    isFree: 1,
                    popularity: el.viewers,
                    popularities: { twitch: el.viewers },
                    type: 'tv'
                })
            })
            cb && cb(null, { metas: results })
        } else if (cb)
            cb(new Error('Network Error'))
    })
}

const getStream = (args, callback) => {
    const channel = args.id.replace('twitch_id:', '');
    if (channel) {
        needle.get('https://api.twitch.tv/api/channels/' + channel + '/access_token', twitch_head, function(err, res) {
            if (err) {
                callback(err);
                return;
            }
            if (res && res.body && res.body.sig && res.body.token) {
                const title = res.body.status;
                const token = encodeURIComponent(res.body.token);
                const sig = res.body.sig;
                const rand = Math.floor((Math.random() * 999999) + 1);
                const mrl = 'https://usher.ttvnw.net/api/channel/hls/' + channel + '.m3u8?player=twitchweb&token=' + token + '&sig=' + sig + '&allow_audio_only=true&allow_source=true&type=any&p=' + rand;
                needle.get(mrl, twitch_head, function(err, res) {
                    if (err || !res || !res.body) {
                        callback(err || new Error('No Response Body'))
                        return
                    }

                    const m3u = Buffer.from(res.body, 'base64').toString('binary')

                    const lines = m3u.split(/\r?\n/)

                    const streams = []

                    lines.forEach((line, ij) => {
                        if (line.startsWith('https:')) {
                            const prevLine = lines[ij-1]
                            let quality
                            if (prevLine.includes('RESOLUTION='))
                                quality = prevLine.split('RESOLUTION=')[1].split(',')[0]
                            streams.push({
                                availability: 1,
                                url: line,
                                title: quality || 'Audio Only',
                                isFree: 1
                            })
                        }
                    })

                    callback(null, streams.length ? { streams } : null)

                })
            } else if (callback)
                callback(new Error('Network Error'));
        })
    } else
        callback(new Error('Stream Missing'))
}

const getMeta = (args, callback) => {
    if (args.id) {
        const twitchId = args.id.replace('twitch_id:','')
        const found = twitch_chans.some( chans => {
            return chans.some( el => {
                if (el.id == args.id) {
                    callback(null, { meta: el })
                    return true
                }
            })
        })
        if (!found) {
            needle.get('http://api.twitch.tv/api/channels/' + twitchId, twitch_head, (err, res) => {
                if (err) {
                    callback(err);
                    return;
                }
                if (res && res.body) {
                    callback(null, {
                        meta: {
                            id: args.id,
                            name: res.body.status,
                            poster: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' + twitchId + '-320x180.jpg',
                            posterShape: 'landscape',
                            backgroundShape: 'contain',
                            logoShape: 'hidden',
                            background: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' + twitchId + '-1920x1080.jpg',
                            genre: [ 'Entertainment' ],
                            isFree: 1,
                            type: 'tv'
                        }
                    })
                } else if (callback)
                    callback(new Error('No Results'));
            })
        }
    } else {
        cb(new Error('No ID'))
    }
}

const catalogMeta = (args, callback) => {
    if (args.extra && args.extra.search)
        searchMeta(args, callback)
    else {
        const offset = args.extra && args.extra.skip ? args.extra.skip : 0
        const limit = args.extra && args.extra.limit ? args.extra.limit : 75

        twitchStreams((err, chans) => {
            if (err) callback(err)
            else
                callback(null, { metas: args.extra && args.extra.limit ? chans.slice(0, args.extra.limit) : chans })
        }, limit, offset)
    }
}

addon.defineStreamHandler(getStream)
addon.defineMetaHandler(getMeta)
addon.defineCatalogHandler(catalogMeta)

addon.runHTTPWithOptions({ port: process.env.PORT || 9028 })
