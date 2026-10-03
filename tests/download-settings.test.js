"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrowser, loadScripts } = require("./helpers");

function load(storage) {
    const { browser } = createBrowser({ storage });
    return loadScripts(["shared/download-settings.js"], { browser })("DownloadSettings");
}

test("normalizeFolder accepts relative paths with either slash", () => {
    const settings = load();
    assert.equal(settings.normalizeFolder("Media\\Reddit"), "Media/Reddit");
    assert.equal(settings.normalizeFolder(" Media//./Reddit/ "), "Media/Reddit");
    assert.equal(settings.normalizeFolder(""), "");
});

test("normalizeFolder rejects unsafe or non-portable paths", () => {
    const settings = load();
    for (const value of ["/home/me", "C:\\Users", "../outside", "a/../b", "a/con", "a/name.", "a?b", 42]) {
        assert.throws(() => settings.normalizeFolder(value), { name: "Error" }, `should reject ${value}`);
    }
});

test("getFolder falls back to the default folder", async () => {
    assert.equal(await load().getFolder(), "media_folder");
    assert.equal(await load({ downloadFolder: "Media\\Reddit" }).getFolder(), "Media/Reddit");
});

test("applyFolder prefixes the folder unless it is empty", async () => {
    assert.equal(await load().applyFolder("a.jpg"), "media_folder/a.jpg");
    assert.equal(await load({ downloadFolder: "" }).applyFolder("a.jpg"), "a.jpg");
});
