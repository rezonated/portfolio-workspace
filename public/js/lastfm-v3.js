const API_KEY = "2efc84e6ddb63a972b5156001674a445";
const USERNAME = "crewsackan";
const PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";
const FALLBACK_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='6' fill='%232a2a2a'/%3E%3Ctext x='32' y='42' text-anchor='middle' fill='%23555' font-size='28' font-family='sans-serif'%3E%E2%99%AB%3C/text%3E%3C/svg%3E";

function urlencode(obj) {
    var str = [];
    for (var p in obj)
        str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
    return str.join("&");
}

$(document).ready(function () {
    function displayMusic() {
        $("#music").show()
    }

    function lastfmRequest(method, params) {
        params['api_key'] = API_KEY;
        params['format'] = "json";

        return fetch("https://ws.audioscrobbler.com/2.0/?method=" + method + "&" + urlencode(params))
            .then((response) => {
                if (response.ok) {
                    return response.json();
                }
                throw new Error('Network response was not ok.');
            });
    }

    function isPlaceholder(url) {
        return !url || url.length === 0 || url.indexOf(PLACEHOLDER_HASH) !== -1;
    }

    function deezerImageSearch(track, artist) {
        var query = encodeURIComponent(track + " " + artist);
        var target = "https://api.deezer.com/search/track?q=" + query + "&limit=1";
        return fetch("https://img-proxy.rezonated.workers.dev/?url=" + encodeURIComponent(target))
            .then((response) => {
                if (response.ok) return response.json();
                throw new Error("Deezer search failed");
            })
            .then((data) => {
                if (data.data && data.data.length > 0) {
                    var art = data.data[0].album.cover_medium;
                    if (art) return art;
                }
                return "";
            })
            .catch(() => {
                return "";
            });
    }

    function getImage(trackinfo) {
        return lastfmRequest("track.getInfo", { autocorrect: 1, track: trackinfo["name"], artist: trackinfo["artist"]["name"] })
            .then((data) => {
                try {
                    var img = data.track.album.image[1]["#text"];
                    if (img && !isPlaceholder(img)) return img;
                    throw new Error("No album image");
                } catch(e) {
                    throw new Error(e);
                }
            })
            .catch((err) => {
                return lastfmRequest("artist.getInfo", { autocorrect: 1, artist: trackinfo["artist"]["name"] })
                    .then((data) => {
                        try {
                            var img = data.artist.image[1]["#text"];
                            if (img && !isPlaceholder(img)) return img;
                            throw new Error("No artist image");
                        } catch(e) {
                            throw new Error(e);
                        }
                    });
            })
            .catch((err) => {
                return deezerImageSearch(trackinfo["name"], trackinfo["artist"]["name"])
                    .then((img) => {
                        if (img && !isPlaceholder(img)) return img;
                        return FALLBACK_IMG;
                    });
            });
    }

    lastfmRequest("user.gettoptracks", { user: USERNAME, limit: "3", period: "7day" }).then((data) => {
        var html = '<h3 class="colorchanger">Top 3 Tracks This Week</h2>';
        $.each(data.toptracks.track, function (i, item) {
            const itemid = item.mbid || ("track-" + i);
            var initialSrc = item.image[1]["#text"];
            var artistUrl = item.artist.url || ("https://www.last.fm/music/" + encodeURIComponent(item.artist.name));

            html += '<div class="music-row">';
            html += '<img id="' + itemid + '" src="' + initialSrc + '">';
            html += '<div class="music-info">';
            html += '<a class="music-track" href="' + item.url + '" target="_blank">' + item.name + '</a>';
            html += '<a class="music-artist" href="' + artistUrl + '" target="_blank">' + item.artist.name + '</a>';
            html += '</div></div>';

            getImage(item).then((img) => {
                $("#" + itemid).attr("src", img);
            });
        });
        displayMusic();
        $('#listening-to').append(html);
    });

    lastfmRequest("user.getrecenttracks", { user: USERNAME, limit: 1 }).then((data) => {
        var item = data.recenttracks.track[0];
        if (!item["@attr"] || !item["@attr"].nowplaying) {
            return;
        }

        let html = '<h3 class="colorchanger">Now Playing</h2>';

        const itemid = item.mbid || "now-playing";
        var initialSrc = item.image[1]["#text"];
        var artistName = item.artist["#text"];
        var artistUrl = "https://www.last.fm/music/" + encodeURIComponent(artistName);

        html += '<div class="music-row">';
        html += '<img id="' + itemid + '" src="' + initialSrc + '">';
        html += '<div class="music-info">';
        html += '<a class="music-track" href="' + item.url + '" target="_blank">' + item.name + '</a>';
        html += '<a class="music-artist" href="' + artistUrl + '" target="_blank">' + artistName + '</a>';
        html += '</div></div>';

        getImage({ name: item["name"], artist: { name: item["artist"]["#text"] } }).then((img) => {
            $("#" + itemid).attr("src", img);
        });

        displayMusic();
        $('#currently-playing').append(html);

    });
});
