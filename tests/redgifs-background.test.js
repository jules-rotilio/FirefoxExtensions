"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDOMParser, createBrowser, createFetch, loadScripts, plain } = require("./helpers");

// Same script order as the background scripts in manifest.json.
const BACKGROUND_SCRIPTS = [
    "shared/debug.js",
    "shared/redgifs-resolver.js",
    "shared/download-settings.js",
    "shared/isolated-download.js",
    "Redgifs Video Downloader/background.js"
];

const PLAYLIST_URL = "https://api.redgifs.com/v2/gifs/abcdef/hd.m3u8";

function load(mediaUrl) {
    const { browser, state } = createBrowser({ manifestName: "Redgifs Video Downloader" });
    const { fetch } = createFetch({
        [PLAYLIST_URL]: { body: `#EXTM3U\n#EXT-X-MAP:URI="${mediaUrl}"\n` }
    });
    loadScripts(BACKGROUND_SCRIPTS, { browser, fetch, DOMParser: FakeDOMParser });
    const send = message => Promise.resolve(state.messageListener(message)).then(plain);
    return { send, state };
}

test("download resolves the watch ID and downloads it as <id>.mp4", async () => {
    const { send, state } = load("https://media.redgifs.com/AbcDef.m4s");
    const result = await send({ action: "download", watchId: "AbcDef" });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(state.downloads.map(item => [item.url, item.filename]),
        [["https://media.redgifs.com/AbcDef.m4s", "media_folder/AbcDef.mp4"]]);
});

test("download ignores URLs from the page and refuses non-Redgifs hosts", async () => {
    const { send, state } = load("https://evil.example/AbcDef.m4s");
    const result = await send({ action: "download", watchId: "AbcDef", url: "https://evil.example/x" });
    assert.match(result.error, /Refusing to download/);
    assert.equal(state.downloads.length, 0);

    assert.deepEqual(await send({ action: "download", watchId: "../x" }),
        { ok: false, error: "Invalid Redgifs video ID" });
});
