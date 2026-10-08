"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    FakeDOMParser,
    createBrowser,
    createFetch,
    loadScripts,
    nextTick,
    plain
} = require("./helpers");

// Same script order as the background scripts in manifest.json.
const BACKGROUND_SCRIPTS = [
    "shared/debug.js",
    "shared/redgifs-resolver.js",
    "shared/download-settings.js",
    "shared/isolated-download.js",
    "Reddit Media Downloader/background.js"
];

const fs = require("node:fs");
const path = require("node:path");

const VIDEO_BASE = "https://v.redd.it/xyz/";
const HLS_ROUTES = {
    [`${VIDEO_BASE}HLSPlaylist.m3u8`]: {
        body: "#EXTM3U\nHLS_AUDIO_64.m3u8\nHLS_AUDIO_128.m3u8\nHLS_480.m3u8\nHLS_720.m3u8\n"
    },
    [`${VIDEO_BASE}HLS_AUDIO_128.m3u8`]: { body: "#EXTM3U\n#EXTINF:10,\nHLS_AUDIO_128.aac\n" }
};

function load({ storage = { downloadFolder: "" }, routes = {}, identities = [] } = {}) {
    const { browser, state } = createBrowser({
        storage,
        identities,
        manifestName: "Reddit Media Downloader"
    });
    const { fetch } = createFetch(routes);
    const get = loadScripts(BACKGROUND_SCRIPTS, { browser, fetch, DOMParser: FakeDOMParser });
    const send = message => state.messageListener(message);
    const startDownload = media => get("startDownload")(media).then(plain);
    return { get, state, send, startDownload };
}

function post(fields) {
    return { subreddit: "pics", id: "1abc2d", ...fields };
}

test("extractMedia recognizes images and adds the subreddit/post prefix", () => {
    const { get } = load();
    assert.deepEqual(plain(get("extractMedia")(post({ url: "http://i.redd.it/x.JPG" }))), {
        type: "image",
        url: "https://i.redd.it/x.JPG",
        namePrefix: "pics_1abc2d"
    });
});

test("extractMedia recognizes galleries, videos and Redgifs links", () => {
    const { get } = load();
    const extractMedia = get("extractMedia");

    const gallery = plain(extractMedia(post({
        url: "https://www.reddit.com/gallery/1abc2d",
        gallery_data: { items: [{ media_id: "m1" }, { media_id: "m2" }] },
        media_metadata: { m1: { m: "image/png" }, m2: { m: "image/jpg" } }
    })));
    assert.deepEqual(gallery.items, ["https://i.redd.it/m1.png", "https://i.redd.it/m2.jpg"]);

    const video = plain(extractMedia(post({
        url: "https://v.redd.it/xyz",
        secure_media: { reddit_video: { fallback_url: `${VIDEO_BASE}DASH_720.mp4`, has_audio: true } }
    })));
    assert.deepEqual(video, {
        type: "video",
        url: `${VIDEO_BASE}DASH_720.mp4`,
        hasAudio: true,
        namePrefix: "pics_1abc2d"
    });

    const redgifs = plain(extractMedia(post({ url: "https://www.redgifs.com/watch/abcdef" })));
    assert.equal(redgifs.type, "redgifs");

    assert.equal(extractMedia(post({ url: "https://example.com/article" })), null);
});

function postJsonRoute(fields) {
    return {
        "https://www.reddit.com/comments/1abc2d.json": {
            body: JSON.stringify([{ data: { children: [{ data: post(fields) }] } }])
        }
    };
}

test("downloadPost looks up the post and downloads its media in one message", async () => {
    const { send, state } = load({ routes: postJsonRoute({ url: "https://i.redd.it/x.png" }) });
    const result = plain(await send({ action: "downloadPost", postId: "1abc2d" }));
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(state.downloads.map(item => [item.url, item.filename]),
        [["https://i.redd.it/x.png", "pics_1abc2d.png"]]);
});

test("downloadPost rejects invalid IDs, posts without media and unknown hosts", async () => {
    const invalid = plain(await load().send({ action: "downloadPost", postId: "../x" }));
    assert.deepEqual(invalid, { ok: false, error: "Invalid Reddit post ID" });

    const noMedia = load({ routes: postJsonRoute({ url: "https://example.com/article" }) });
    assert.deepEqual(plain(await noMedia.send({ action: "downloadPost", postId: "1abc2d" })),
        { ok: false, error: "No downloadable media found in this post" });

    const otherHost = load({ routes: postJsonRoute({ url: "https://example.com/picture.jpg" }) });
    const refused = plain(await otherHost.send({ action: "downloadPost", postId: "1abc2d" }));
    assert.match(refused.error, /Refusing to download from https:\/\/example\.com/);
    assert.equal(otherHost.state.downloads.length, 0);
});

test("the old two-step messages are no longer accepted", () => {
    const { send } = load();
    assert.equal(send({ action: "downloadMedia", media: { type: "image", url: "https://i.redd.it/x.jpg" } }), undefined);
    assert.equal(send({ action: "getPostMedia", postId: "1abc2d" }), undefined);
});

test("images are named <subreddit>_<postId> inside the download folder", async () => {
    const { startDownload, state } = load({ storage: {} });
    const media = { type: "image", url: "https://i.redd.it/x.JPG", namePrefix: "pics_1abc2d" };
    assert.equal((await startDownload(media)).ok, true);
    assert.equal(state.downloads[0].filename, "media_folder/pics_1abc2d.jpg");
});

test("galleries are numbered and share one container", async () => {
    const { startDownload, state } = load();
    const media = {
        type: "gallery",
        items: ["https://i.redd.it/m1.png", "https://i.redd.it/m2.jpg"],
        namePrefix: "pics_1abc2d"
    };
    await startDownload(media);
    assert.deepEqual(state.downloads.map(item => item.filename),
        ["pics_1abc2d_01.png", "pics_1abc2d_02.jpg"]);
    assert.equal(state.createdIdentities.length, 1);
});

test("videos with audio download the best HLS video and audio with a shared prefix", async () => {
    const { startDownload, state } = load({ routes: HLS_ROUTES });
    const media = {
        type: "video",
        url: `${VIDEO_BASE}DASH_720.mp4?source=fallback`,
        hasAudio: true,
        namePrefix: "pics_1abc2d"
    };
    const result = await startDownload(media);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(
        state.downloads.map(item => [item.url, item.filename]),
        [
            [`${VIDEO_BASE}HLS_720.ts`, "pics_1abc2d_HLS_720.ts"],
            [`${VIDEO_BASE}HLS_AUDIO_128.aac`, "pics_1abc2d_HLS_AUDIO_128.aac"]
        ]
    );
    assert.equal(state.createdIdentities.length, 1);
});

// Playlists captured from a real Reddit video in the newer CMAF format
// (segment lists shortened).
function cmafRoutes() {
    const dir = path.join(__dirname, "fixtures", "reddit-cmaf");
    return Object.fromEntries(fs.readdirSync(dir).map(file =>
        [`${VIDEO_BASE}${file}`, { body: fs.readFileSync(path.join(dir, file), "utf8") }]));
}

test("CMAF videos with audio download the best video and audio files from the playlists", async () => {
    const { startDownload, state } = load({ routes: cmafRoutes() });
    const media = {
        type: "video",
        url: `${VIDEO_BASE}CMAF_720.mp4?source=fallback`,
        hasAudio: true,
        namePrefix: "pics_1abc2d"
    };
    const result = await startDownload(media);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(
        state.downloads.map(item => [item.url, item.filename]),
        [
            [`${VIDEO_BASE}CMAF_720.mp4`, "pics_1abc2d_CMAF_720.mp4"],
            [`${VIDEO_BASE}CMAF_AUDIO_128.mp4`, "pics_1abc2d_CMAF_AUDIO_128.mp4"]
        ]
    );
    assert.equal(state.createdIdentities.length, 1);
});

test("videos without audio keep Reddit's file name after the prefix", async () => {
    const { startDownload, state } = load();
    const media = { type: "video", url: `${VIDEO_BASE}DASH_720.mp4?source=fallback`, namePrefix: "pics_1abc2d" };
    await startDownload(media);
    assert.equal(state.downloads[0].filename, "pics_1abc2d_DASH_720.mp4");
});

test("leftover download containers are removed at startup", async () => {
    const { state } = load({
        identities: [{ name: "Reddit Media Downloader download 1-a", cookieStoreId: "stale" }]
    });
    await nextTick();
    assert.deepEqual(state.identities, []);
});
