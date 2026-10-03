"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDOMParser, createFetch, loadScripts } = require("./helpers");

const PLAYLIST_URL = "https://api.redgifs.com/v2/gifs/abcdef/hd.m3u8";
const WATCH_URL = "https://www.redgifs.com/watch/AbcDef";

function load(routes) {
    const { fetch, calls } = createFetch(routes);
    const resolver = loadScripts(["shared/redgifs-resolver.js"], {
        fetch,
        DOMParser: FakeDOMParser
    })("RedgifsResolver");
    return { resolver, calls };
}

function watchPage({ ogVideo, directMp4 } = {}) {
    return [
        "<html><head>",
        ogVideo ? `<meta property="og:video" content="${ogVideo}">` : "",
        "</head><body>",
        directMp4 ? `<script>var src="${directMp4}";</script>` : "",
        "</body></html>"
    ].join("");
}

test("upgradeHttpUrl switches http to https and rejects other schemes", () => {
    const { resolver } = load();
    assert.equal(resolver.upgradeHttpUrl("http://media.redgifs.com/a.mp4"),
        "https://media.redgifs.com/a.mp4");
    assert.throws(() => resolver.upgradeHttpUrl("ftp://example.com/a.mp4"));
});

test("resolve uses the HLS playlist first", async () => {
    // Regression test: the playlist body used to be read twice, which always
    // threw and silently skipped this step.
    const { resolver, calls } = load({
        [PLAYLIST_URL]: { body: '#EXTM3U\n#EXT-X-MAP:URI="https://media.redgifs.com/AbcDef.m4s"\n' }
    });
    assert.equal(await resolver.resolve("AbcDef"), "https://media.redgifs.com/AbcDef.m4s");
    assert.ok(calls.every(call => call.url !== WATCH_URL), "watch page should not be fetched");
    assert.ok(calls.every(call => call.credentials === "omit"), "no cookies are sent");
});

test("resolve prefers the og:video URL without -silent", async () => {
    const { resolver } = load({
        [WATCH_URL]: { body: watchPage({ ogVideo: "https://media.redgifs.com/AbcDef-silent.mp4" }) },
        "https://media.redgifs.com/AbcDef.mp4": { status: 200 }
    });
    assert.equal(await resolver.resolve("AbcDef"), "https://media.redgifs.com/AbcDef.mp4");
});

test("resolve falls back to a direct mp4 link, then to the -silent video", async () => {
    const silent = "https://media.redgifs.com/AbcDef-silent.mp4";
    const direct = "https://media.redgifs.com/AbcDef.mp4";

    // The og:video URL is itself a media.redgifs.com link, so the direct-link
    // search only adds something when the page has no og:video tag.
    const withDirect = load({ [WATCH_URL]: { body: watchPage({ directMp4: direct }) } });
    assert.equal(await withDirect.resolver.resolve("AbcDef"), direct);

    const silentOnly = load({ [WATCH_URL]: { body: watchPage({ ogVideo: silent }) } });
    assert.equal(await silentOnly.resolver.resolve("AbcDef"), silent);
});

test("resolve reports errors from the watch page", async () => {
    const { resolver } = load({ [WATCH_URL]: { status: 500 } });
    await assert.rejects(resolver.resolve("AbcDef"), { message: "Redgifs returned HTTP 500" });

    const empty = load({ [WATCH_URL]: { body: watchPage() } });
    await assert.rejects(empty.resolver.resolve("AbcDef"), { message: /did not expose/ });
});

test("fetchText times out when the body stalls after the headers arrive", async () => {
    const { resolver } = load({ [PLAYLIST_URL]: { stallBody: true } });
    await assert.rejects(resolver.fetchText(PLAYLIST_URL, {}, 20), { name: "AbortError" });
});
