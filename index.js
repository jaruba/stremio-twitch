const addonSDK = require('stremio-addon-sdk')
const needle = require('needle')
const _ = require('lodash')

const twitch_head = { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID } }


needle.get('https://api.twitch.tv/kraken/games/top?limit=100', twitch_head, (err, res) => {

    let genres = []

    if (err || !res || !res.body || !res.body.top || !res.body.top.length)
        console.log('Could not get game list for filter')
    else
        genres = res.body.top.map( game => { return game.game.name })

    const twitch_chans = {}

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
                genres,
                extraSupported: ['genre', 'search', 'skip']
            }
        ]
    })

    var expire = {};

    // Get all channels
    const twitchStreams = (cb, limit, offset, genre) => {

        const tag = genre || 'top'

        if (!expire[tag])
            expire[tag] = []

        if (!twitch_chans[tag])
            twitch_chans[tag] = []

        if (expire[tag][offset] && expire[tag][offset] > Date.now()) {
            if (twitch_chans[tag][offset] && twitch_chans[tag][offset].length && cb) {
                cb(null, twitch_chans[tag][offset])
                return
            }
        }

        let twitchUrl = 'https://api.twitch.tv/kraken/streams?'

        if (genre)
            twitchUrl += 'game=' + escape(genre).replace('/', '%2F')

        twitchUrl += '&limit=' + (limit || 75) + '&offset=' + (offset || 0)

        needle.get(twitchUrl, twitch_head, (err, res) => {
            if (err) {
                cb && cb(err)
                return
            }
            twitch_chans[tag][offset] = []
            if (res && res.body && res.body.streams && res.body.streams.length) {
                const channel = res.body.streams[0].channel.name;
                res.body.streams.forEach( (el, ij) => {
                    twitch_chans[tag][offset].push({
                        id: 'twitch_id:' + el.channel.name,
                        name: el.channel.status,
                        poster: el.preview.medium,
                        posterShape: 'landscape',
                        logo: el.channel.logo,
                        background: el.channel.video_banner || el.preview.template.replace('{width}', '1920').replace('{height}', '1080'),
                        genres: [ el.game ],
                        isFree: 1,
                        type: 'tv'
                    });
                });
                expire[tag][offset] = Date.now() + 900000; // expire in 15 mins
                cb && cb(null, twitch_chans[tag][offset]);
            } else if (cb)
                cb(new Error('Network Error'));
        });
    }

    const searchMeta = (args, cb) => {

        var searcher = encodeURIComponent(args.extra.search).split('%20').join('+');

        needle.get('https://api.twitch.tv/kraken/search/streams?limit=' + (args.extra.limit || 75) + '&offset=' + (args.extra.skip || 0) + '&q=' + searcher, twitch_head, (err, res) => {
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
            needle.get('https://api.twitch.tv/api/channels/' + channel + '/access_token', twitch_head, (err, res) => {
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
                    needle.get(mrl, twitch_head, (err, res) => {
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

                                let getRes = () => {
                                    return prevLine.includes('RESOLUTION=') ? prevLine.split('RESOLUTION=')[1].split(',')[0] : null
                                }

                                let getPixels = (resolution) => {
                                    return resolution ? resolution.split('x')[1] + 'p' : null
                                }

                                let tag

                                let videoData


                                if (prevLine.includes('VIDEO="')) {

                                    videoData = prevLine.split('VIDEO="')[1].split('"')[0]

                                    let fps

                                    if (videoData.includes('p'))
                                        fps = videoData.split('p')[1] + 'fps'

                                    const pixels = getPixels(getRes())

                                    tag = videoData == 'audio_only' ? 'Audio Only' : (pixels + ' / ' + (fps || videoData))

                                } else {

                                    tag = getPixels(getRes()) || 'Audio Only'

                                    if (prevLine.includes('CODECS="'))
                                        tag += ' , ' + prevLine.split('CODECS="')[1].split('",')[0]

                                }

                                streams.push({
                                    url: line,
                                    title: tag
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
            const found = twitch_chans['top'] ? twitch_chans['top'].some( chans => {
                return chans.some( el => {
                    if (el.id == args.id) {
                        callback(null, { meta: el })
                        return true
                    }
                })
            }) : false
            if (!found) {
                needle.get('https://api.twitch.tv/api/channels/' + twitchId, twitch_head, (err, res) => {
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
                                logo: res.body.logo,
                                description: res.body.bio,
                                genres: [res.body.game],
                                background: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' + twitchId + '-1920x1080.jpg',
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

        const offset = args.extra && args.extra.skip ? args.extra.skip : 0
        const limit = args.extra && args.extra.limit ? args.extra.limit : 75
        const genre = args.extra && args.extra.genre ? args.extra.genre : null

        if (args.extra && args.extra.search)
            searchMeta(args, callback)
        else if (genre)
            twitchStreams((err, chans) => {
                if (err) callback(err)
                else
                    callback(null, { metas: args.extra && args.extra.limit ? chans.slice(0, args.extra.limit) : chans })
            }, limit, offset, genre)
        else
            twitchStreams((err, chans) => {
                if (err) callback(err)
                else
                    callback(null, { metas: args.extra && args.extra.limit ? chans.slice(0, args.extra.limit) : chans })
            }, limit, offset)
    }

    addon.defineStreamHandler(getStream)
    addon.defineMetaHandler(getMeta)
    addon.defineCatalogHandler(catalogMeta)

    addon.runHTTPWithOptions({ port: process.env.PORT || 9028 })

    addon.publishToCentral('https://stremio-twitch.now.sh/manifest.json')

})
