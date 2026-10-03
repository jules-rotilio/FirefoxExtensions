"use strict";
// Test helpers: load extension scripts into a sandbox with fake browser APIs.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

// Runs the given files (paths relative to the repository root) in one shared
// sandbox, like Firefox does with the scripts listed in manifest.json.
function loadScripts(files, globals = {}) {
    const context = vm.createContext({
        console,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        navigator: { userAgent: "test-agent" },
        ...globals
    });
    for (const file of files) {
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        vm.runInContext(code, context, { filename: file });
    }
    // Top-level const/function declarations are read back by name.
    return name => vm.runInContext(name, context);
}

// Objects created in the sandbox have their own prototypes, so compare plain copies.
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function nextTick() {
    return new Promise(resolve => setImmediate(resolve));
}

function createEvent() {
    const listeners = new Set();
    return {
        addListener: listener => listeners.add(listener),
        removeListener: listener => listeners.delete(listener),
        emit: (...args) => [...listeners].forEach(listener => listener(...args)),
        get size() {
            return listeners.size;
        }
    };
}

// A fake `browser` object. `state` records what the code under test did.
function createBrowser({ storage = {}, identities = [], manifestName = "Test Extension" } = {}) {
    let nextId = 1;
    const state = {
        storage: { ...storage },
        identities: [...identities],
        createdIdentities: [],
        removedIdentities: [],
        downloads: [],
        messageListener: null,
        // Set to a function returning true to make browser.downloads.download fail.
        refuseDownload: null,
        // State a new download starts in ("in_progress" or "complete").
        initialDownloadState: "in_progress"
    };

    const browser = {
        runtime: {
            getManifest: () => ({ name: manifestName }),
            onMessage: {
                addListener: listener => {
                    state.messageListener = listener;
                }
            }
        },
        storage: {
            local: {
                get: async key => key in state.storage ? { [key]: state.storage[key] } : {},
                set: async values => {
                    Object.assign(state.storage, values);
                }
            }
        },
        contextualIdentities: {
            create: async ({ name }) => {
                const identity = { name, cookieStoreId: `firefox-container-${nextId++}` };
                state.identities.push(identity);
                state.createdIdentities.push(identity);
                return identity;
            },
            query: async () => state.identities.map(identity => ({ ...identity })),
            remove: async cookieStoreId => {
                state.identities = state.identities
                    .filter(identity => identity.cookieStoreId !== cookieStoreId);
                state.removedIdentities.push(cookieStoreId);
            }
        },
        downloads: {
            onChanged: createEvent(),
            download: async options => {
                if (state.refuseDownload?.(options)) throw new Error("Download refused");
                const id = nextId++;
                state.downloads.push({ id, state: state.initialDownloadState, ...options });
                return id;
            },
            search: async ({ id }) => state.downloads
                .filter(item => item.id === id)
                .map(item => ({ id: item.id, state: item.state }))
        }
    };

    // Simulates Firefox finishing a download.
    state.finishDownload = (id, result = "complete") => {
        state.downloads.find(item => item.id === id).state = result;
        browser.downloads.onChanged.emit({ id, state: { current: result } });
    };
    state.containerExists = cookieStoreId =>
        state.identities.some(identity => identity.cookieStoreId === cookieStoreId);

    return { browser, state };
}

// A fake `fetch`. `routes` maps a URL to { status, body } or to a function
// (options) => { status, body }. Unknown URLs answer 404. A route with
// `stallBody: true` never finishes sending its body, until the request is aborted.
function createFetch(routes = {}) {
    const calls = [];
    async function fetch(url, options = {}) {
        calls.push({ url, method: options.method || "GET", credentials: options.credentials });
        const route = routes[url];
        const result = typeof route === "function" ? route(options) : route;
        return createResponse(url, result?.status ?? (result ? 200 : 404), result?.body ?? "", {
            stallBody: result?.stallBody === true,
            signal: options.signal
        });
    }
    return { fetch, calls };
}

function createResponse(url, status, body, { stallBody = false, signal } = {}) {
    let used = false;
    // Like a real Response, the body can only be read once, and aborting the
    // request also stops reading the body.
    const read = async () => {
        if (used) throw new TypeError("Body has already been consumed.");
        used = true;
        if (stallBody) {
            await new Promise((resolve, reject) => {
                signal?.addEventListener("abort", () =>
                    reject(new DOMException("The operation was aborted.", "AbortError")));
            });
        }
        return body;
    };
    return {
        ok: status >= 200 && status < 300,
        status,
        url,
        text: () => read(),
        json: async () => JSON.parse(await read())
    };
}

// Minimal DOMParser: enough for the resolver's og:video lookup.
class FakeDOMParser {
    parseFromString(html) {
        return {
            querySelector(selector) {
                if (selector !== 'meta[property="og:video"]') return null;
                const match = html.match(/<meta property="og:video" content="([^"]*)"/);
                return match ? { content: match[1] } : null;
            }
        };
    }
}

module.exports = {
    FakeDOMParser,
    createBrowser,
    createFetch,
    loadScripts,
    nextTick,
    plain
};
