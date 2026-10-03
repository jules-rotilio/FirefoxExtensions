"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrowser, loadScripts, nextTick, plain } = require("./helpers");

function load(options) {
    const { browser, state } = createBrowser({ manifestName: "Test Extension", ...options });
    const downloader = loadScripts(["shared/isolated-download.js"], { browser })("IsolatedDownloader");
    return { downloader, state, browser };
}

const OPTIONS = { allowedDomains: ["redd.it"] };

const FILES = [
    { url: "https://i.redd.it/a.jpg", filename: "a.jpg" },
    { url: "https://i.redd.it/b.jpg", filename: "b.jpg" }
];

test("downloadAll uses one container and removes it after every download finishes", async () => {
    const { downloader, state, browser } = load();
    const ids = plain(await downloader.downloadAll(FILES, OPTIONS));

    assert.equal(state.createdIdentities.length, 1);
    const container = state.createdIdentities[0].cookieStoreId;
    assert.ok(state.downloads.every(item => item.cookieStoreId === container));

    state.finishDownload(ids[0]);
    await nextTick();
    assert.ok(state.containerExists(container), "kept while a download is running");

    state.finishDownload(ids[1], "interrupted");
    await nextTick();
    assert.ok(!state.containerExists(container), "removed once all are finished");
    assert.equal(browser.downloads.onChanged.size, 0, "listener removed");
});

test("downloadAll removes the container when downloads finished instantly", async () => {
    const { downloader, state } = load();
    state.initialDownloadState = "complete";
    await downloader.downloadAll(FILES, OPTIONS);
    assert.equal(state.identities.length, 0);
});

test("downloadAll rejects when a download cannot start, and still cleans up", async () => {
    const { downloader, state } = load();
    state.refuseDownload = options => options.filename === "b.jpg";

    await assert.rejects(downloader.downloadAll(FILES, OPTIONS), { message: "Download refused" });
    const container = state.createdIdentities[0].cookieStoreId;
    assert.ok(state.containerExists(container), "kept for the download that did start");

    state.finishDownload(state.downloads[0].id);
    await nextTick();
    assert.ok(!state.containerExists(container));
});

test("download returns a single download ID", async () => {
    const { downloader, state } = load();
    const id = await downloader.download("https://i.redd.it/a.jpg", "a.jpg", OPTIONS);
    assert.equal(id, state.downloads[0].id);
});

test("downloads from other domains are refused before anything starts", async () => {
    const { downloader, state } = load();
    for (const url of ["https://evil.example/a.jpg", "https://notredd.it/a.jpg", "http://i.redd.it/a.jpg"]) {
        await assert.rejects(
            downloader.downloadAll([...FILES, { url, filename: "x.jpg" }], OPTIONS),
            { message: /Refusing to download/ },
            url
        );
    }
    assert.equal(state.createdIdentities.length, 0);
    assert.equal(state.downloads.length, 0);
});

test("removeStaleContainers removes only this extension's leftover containers", async () => {
    const { downloader, state } = load({
        identities: [
            { name: "Personal", cookieStoreId: "firefox-container-personal" },
            { name: "Test Extension download 123-abc", cookieStoreId: "firefox-container-stale" },
            { name: "Extension download 456-def", cookieStoreId: "firefox-container-legacy" },
            { name: "Other Extension download 789", cookieStoreId: "firefox-container-other" }
        ]
    });
    await downloader.removeStaleContainers();
    assert.deepEqual(
        state.identities.map(identity => identity.name),
        ["Personal", "Other Extension download 789"]
    );
});
