var tape = require("tape");
var _ = require("lodash");

var Stremio = require("stremio-addons");

var server = require("../twitch");

var PORT = 9005;
var someChannel;

tape("listening on port", function(t) {
    t.timeoutAfter(500);

    var server = require("../twitch").listen(PORT).on("listening", function() {
        t.ok(PORT == server.address().port, "server is listening on port")
        t.end();
    })
});

tape("initializes properly", function(t) {
    t.timeoutAfter(1000);

    addon = new Stremio.Client();
    addon.setAuth("http://api8.herokuapp.com", "423f59935153f2f5d2db0f6c9b812592b61b3737"); // cinema token
    addon.add("http://localhost:"+PORT);
    addon.on("addon-ready", function(service) {
        t.ok(service.manifest, "has manifest");
        t.ok(service.manifest.name, "has name");
        t.ok(service.manifest.methods && service.manifest.methods.length, "has methods");
        t.ok(service.manifest.methods && service.manifest.methods.indexOf("stream.find")!=-1, "has stream.find method");
        t.ok(service.manifest.methods && service.manifest.methods.indexOf("stream.get")!=-1, "has stream.get method");
        t.ok(service.manifest.methods && service.manifest.methods.indexOf("meta.find")!=-1, "has meta.find method");
        t.ok(service.manifest.methods && service.manifest.methods.indexOf("meta.get")!=-1, "has meta.get method");
        t.end();
    });
});


tape("meta.find", function(t) {
    addon.meta.find({ query: {}, sort: { popularity: -1 }, limit: 5 }, function(err, res) {
        t.notOk(err, "has error");
        t.ok(res, "has res object");
        t.ok(res.length, "has results");
        t.ok(res.length == 5, "results are limited to 5");
        
        someChannel = res[0];

        t.ok(someChannel.poster, "has poster");
        t.ok(someChannel.name, "has name");
        t.ok(someChannel.popularity, "has popularity");
        t.equal(someChannel.type, "tv", "type is tv");

        t.end();
    });
});


tape("meta.get single result", function(t) {
    addon.meta.get({ query: { twitch_id: someChannel.twitch_id } }, function(err, res) {
        t.notOk(err, "has error");
        t.equal(res.twitch_id, someChannel.twitch_id, "id matches");

        t.ok(res.poster, "has poster");
        t.ok(res.banner, "has banner");
        t.ok(res.name, "has name");
        t.ok(res.popularity, "has popularity");

        t.end();
    });
});



tape("stream.find", function(t) {
    addon.stream.find({ query: { twitch_id: someChannel.twitch_id } }, function(err, res) {
        t.notOk(err, "has error");

        t.ok(res, "has res object");
        t.ok(res.length, "has results");

        t.ok(res[0].url, "has url for first result");
        t.ok(res[0].availability, "has availability for first result");

        t.end();
    });
});