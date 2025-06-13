const API_KEY = "2efc84e6ddb63a972b5156001674a445";
const USERNAME = "crewsackan";

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

        return fetch("https://ws.audioscrobbler.com/2.0/?method=" + method + "&" + urlencode(params) + "&format=json")
            .then((response) => {
                if (response.ok) {
                    return response.json();
                }
                throw new Error('Network response was not ok.');
            });
    }

    function getImage(trackinfo) {
        return lastfmRequest("track.getInfo", { autocorrect: 1, track: trackinfo["name"], artist: trackinfo["artist"]["name"] })
            .then((data) => {
                    try {
                        return data.track.album.image[1]["#text"];
                    } catch(e) {
                        throw new Error(e)
                    }
                });
    }

    lastfmRequest("user.gettoptracks", { user: USERNAME, limit: "3", period: "7day" }).then((data) => {
        var html = '<h3 class="colorchanger">Top 3 Tracks This Week</h2>';
        $.each(data.toptracks.track, function (i, item) {
            const itemid = item.mbid;

            html += '<div class="music-row">';
            html += '<img id="' + itemid + '" src="' + item.image[1]["#text"] + '">';
            html += '<div><a href="' + item.url + '" target="_blank">' + item.name + '</a> - ' + item.artist['name'] + '</div></div>';

            getImage(item).then((img) => {
                $("#" + itemid).attr("src", img);
            });
        });
        displayMusic();
        $('#listening-to').append(html);
    });

    lastfmRequest("user.getrecenttracks", { user: USERNAME, limit: 1 }).then((data) => {
        console.log(data);

        var item = data.recenttracks.track[0];
        if (!item["@attr"] || !item["@attr"].nowplaying) {
            return;
        }

        let html = '<h3 class="colorchanger">Now Playing</h2>';

        const itemid = item.mbid;

        html += '<div class="music-row">';
        html += '<img id="' + itemid + '" src="' + item.image[1]["#text"] + '">';
        html += '<div><a href="' + item.url + '" target="_blank">' + item.name + '</a> - ' + item.artist['#text'] + '</div></div>';

        getImage({ name: item["name"], artist: { name: item["artist"]["#text"] } }).then((img) => {
            $("#" + itemid).attr("src", img);
        });

        displayMusic();
        $('#currently-playing').append(html);

    });
});