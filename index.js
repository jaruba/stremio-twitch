const { serveHTTP, addonBuilder } = require('stremio-addon-sdk')
const needle = require('needle')
const _ = require('lodash')

const twitch_head = { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID } }

const caches = {
    catalog: 15 * 60, // 15min
    meta: 30 * 60, // 30min
    streams: 15 * 60, // 15min
    search: 15 * 60, // 15min, searching is currently disabled
}

const cursors = {}

let genreMap = {}

needle.get('https://api.twitch.tv/helix/games/top?first=100', twitch_head, (err, res) => {

    let genres = []

    if (err || !res || !res.body || !res.body.data || !res.body.data.length)
        console.log('Could not get game list for filter')
    else
        genres = res.body.data.map( game => { return game.name })

    genreMap = res.body.data

    const twitch_chans = {}

    const pkg = require("./package");

    const addon = new addonBuilder({
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
                extraSupported: [
                    { name: 'genre' },
//                    { name: 'search'},
                    { name: 'skip' }
                ]
            }
        ]
    })

    var expire = {};

    // Get all channels
    const twitchStreams = (cb, limit, offset, genre) => {

        const tag = genre || 'top'

        let tagId

        if (genre != 'top') {
            genreMap.some(el => {
                if (el.name == genre)
                    tagId = el.id
            })
        }

        if (!cursors[tag])
            cursors[tag] = {}

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

        let twitchUrl = 'https://api.twitch.tv/helix/streams?'

        if (genre) {
            if (tagId)
                twitchUrl += 'game_id=' + tagId
            else {
                cb(Error('no genre id found for genre: ' + tag))
                return
            }
        }

        twitchUrl += '&first=' + (limit || 100)

        if (offset) {
            if (cursors[tag][offset + ''])
                twitchUrl += '&after=' + cursors[tag][offset + '']
            else {
                cb(Error('cursor for pagination missing for offset ' + offset + ' of genre ' + tag))
                return
            }
        }

        needle.get(twitchUrl, twitch_head, (err, res) => {
            if (err) {
                cb && cb(err)
                return
            }
            twitch_chans[tag][offset] = []
            if (res && res.body && res.body.data && res.body.data.length) {
                res.body.data.forEach( (el, ij) => {
                    let channel = res.body.data[0].user_name;
                    if ((el.thumbnail_url || '').includes('user_')) {
                        channel = el.thumbnail_url.split('user_')[1]
                        channel = channel.split('-')[0]
                    }
                    twitch_chans[tag][offset].push({
                        id: 'twitch_id:' + channel,
                        name: el.title,
                        poster: el.thumbnail_url ? el.thumbnail_url.replace('{width}', '300').replace('{height}', '170') : undefined,
                        posterShape: 'landscape',
//                        logo: el.logo,
                        background: el.thumbnail_url ? el.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') : undefined,
//                        genres: [ el.game ],
                        type: 'tv'
                    });
                });
                if ((res.body.pagination || {}).cursor)
                    cursors[tag][parseInt(limit || 100) + parseInt(offset || 0) + ''] = res.body.pagination.cursor
                expire[tag][offset] = Date.now() + 900000; // expire in 15 mins
                cb && cb(null, twitch_chans[tag][offset]);
            } else if (cb)
                cb(new Error('Network Error'));
        });
    }

    const searchMeta = args => {

        return new Promise((resolve, reject) => {

            var searcher = encodeURIComponent(args.extra.search).split('%20').join('+');

            needle.get('https://api.twitch.tv/helix/search/streams?limit=' + (args.extra.limit || 75) + '&q=' + searcher, twitch_head, (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                const results = [];

                if ((((res || {}).body || {}).data || []).length) {
                    res.body.data.forEach( (el, ij) => {
                        let channel = res.body.data[0].user_name;
                        if ((el.thumbnail_url || '').includes('user_')) {
                            channel = el.thumbnail_url.split('user_')[1]
                            channel = channel.split('-')[0]
                        }
                        results.push({
                            id: 'twitch_id:' + channel,
                            name: el.title,
                            poster: el.thumbnail_url ? el.thumbnail_url.replace('{width}', '300').replace('{height}', '170') : undefined,
                            posterShape: 'landscape',
    //                        logo: el.logo,
                            background: el.thumbnail_url ? el.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080') : undefined,
    //                        genres: [ el.game ],
                            type: 'tv'
                        });
                    });
                    resolve({ metas: results, cacheMaxAge: caches.search })
                } else
                    reject(Error('Network Error'))
            })
        })
    }

    const getStream = args => {

        return new Promise((resolve, reject) => {
            const channel = args.id.replace('twitch_id:', '');
            if (channel) {

                needle.get('https://api.twitch.tv/api/channels/' + encodeURIComponent(channel) + '/access_token', twitch_head, (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if ((res || {}).body && res.body.sig && res.body.token) {

                        const title = res.body.status;
                        const token = encodeURIComponent(res.body.token);
                        const sig = res.body.sig;
                        const rand = Math.floor((Math.random() * 999999) + 1);
                        const mrl = 'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(channel) + '.m3u8?player=twitchweb&token=' + token + '&sig=' + sig + '&allow_audio_only=true&allow_source=true&type=any&p=' + rand;

                        needle.get(mrl, twitch_head, (err, res) => {

                            if (err || !res || !res.body) {
                                reject(err || new Error('No Response Body'))
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

                            streams.push({
                                title: 'Channel Chat',
                                externalUrl: 'https://www.twitch.tv/popout/' + encodeURIComponent(channel) + '/chat'
                            })

                            resolve({ streams, cacheMaxAge: caches.streams })

                        })
                    } else
                        reject(Error('Network Error'));
                })
            } else
                reject(Error('Stream Missing'))
        })
    }

    const getMeta = args => {
        return new Promise((resolve, reject) => {
            if (args.id) {
                const twitchId = args.id.replace('twitch_id:','')
                const found = twitch_chans['top'] ? twitch_chans['top'].some( chans => {
                    return chans.some( el => {
                        if (el.id == args.id) {
                            resolve({ meta: el })
                            return true
                        }
                    })
                }) : false
                if (!found) {
                    needle.get('https://api.twitch.tv/api/channels/' + twitchId, twitch_head, (err, res) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        if (res && res.body) {
                            resolve({
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
                                },
                                cacheMaxAge: caches.meta
                            })
                        } else
                            reject(Error('No Results'))
                    })
                }
            } else {
                reject(Error('No ID'))
            }
        })
    }

    const catalogMeta = args => {

        return new Promise((resolve, reject) => {

            const offset = args.extra && args.extra.skip ? args.extra.skip : 0
            const limit = args.extra && args.extra.limit ? args.extra.limit : 100
            const genre = args.extra && args.extra.genre ? args.extra.genre : null

            if (args.extra && args.extra.search)
                searchMeta(args).then(resolve).catch(reject)
            else if (genre)
                twitchStreams((err, chans) => {
                    if (err) reject(err)
                    else
                        resolve({ metas: args.extra && args.extra.limit ? chans.slice(0, args.extra.limit) : chans, cacheMaxAge: caches.catalog })
                }, limit, offset, genre)
            else
                twitchStreams((err, chans) => {
                    if (err) reject(err)
                    else
                        resolve({ metas: args.extra && args.extra.limit ? chans.slice(0, args.extra.limit) : chans, cacheMaxAge: caches.catalog })
                }, limit, offset)

        })
    }

    addon.defineStreamHandler(getStream)
    addon.defineMetaHandler(getMeta)
    addon.defineCatalogHandler(catalogMeta)


    const addonInterface = addon.getInterface();
    serveHTTP(addonInterface, { port: process.env.PORT || 9028 });

})
