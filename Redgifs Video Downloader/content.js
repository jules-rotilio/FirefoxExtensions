/*
 * Page-side UI for Redgifs watch pages.
 *
 * The content script only identifies the current watch ID, displays the
 * button, and delegates network/download work to background.js.
 */

const DEBUG = false;
const LOG_PREFIX = "[Redgifs Downloader]";
const BUTTON_ID = "redgifs-video-downloader-button";
const WATCH_URL_PATTERN =
    /^https:\/\/(?:www\.|v3\.)?redgifs\.com\/watch\/([A-Za-z0-9]+)/i;

const debug = ExtensionDebug.create(DEBUG, LOG_PREFIX);

function getWatchId(url) {
    const match = url.match(WATCH_URL_PATTERN);
    return match ? match[1] : null;
}

function getWatchIdFromElement(element) {
    if (!(element instanceof Element)) return null;

    const links = [
        element,
        ...element.querySelectorAll("a[href]")
    ];
    for (const link of links) {
        const href = link instanceof HTMLAnchorElement
            ? link.href
            : link.getAttribute("href");
        const watchId = href ? getWatchId(href) : null;
        if (watchId) return watchId;
    }
    return null;
}

function getVisibleVideoScore(video) {
    const bounds = video.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const visibleWidth = Math.max(
        0,
        Math.min(bounds.right, viewportWidth) - Math.max(bounds.left, 0)
    );
    const visibleHeight = Math.max(
        0,
        Math.min(bounds.bottom, viewportHeight) - Math.max(bounds.top, 0)
    );
    const visibleArea = visibleWidth * visibleHeight;
    const isPlaying = !video.paused && !video.ended && video.readyState > 0;
    return visibleArea + (isPlaying ? viewportWidth * viewportHeight : 0);
}

/**
 * Redgifs may reuse one page URL while replacing the visible feed video.
 * Find the watch link belonging to the most visible/playing video first.
 */
function getCurrentWatchId() {
    const activeCard = document.querySelector(
        '[data-feed-item-id].GifPreview_isActive[data-feed-item-id]'
    );
    const activeCardId = activeCard?.getAttribute("data-feed-item-id") || null;
    if (activeCardId) {
        debug("Detected active feed card", {
            activeCardId,
            source: "GifPreview_isActive"
        });
        return activeCardId;
    }

    const videos = [...document.querySelectorAll("video")];
    const candidates = videos
        .map((video) => {
            let container = video;
            let watchId = null;

            // The watch link is commonly on a parent card rather than the
            // video element itself, so inspect a few ancestor levels.
            for (let level = 0; level < 6 && container; level += 1) {
                watchId = getWatchIdFromElement(container);
                if (watchId) break;
                container = container.parentElement;
            }

            return {
                video,
                watchId,
                score: watchId ? getVisibleVideoScore(video) : -1
            };
        })
        .filter((candidate) => candidate.watchId)
        .sort((left, right) => right.score - left.score);

    const activeCandidate = candidates[0] || null;
    const pageWatchId = getWatchId(window.location.href);
    const watchId = activeCandidate?.watchId || pageWatchId;

    debug("Detected current video", {
        currentId: watchId,
        source: activeCandidate ? "visible video card" : "page URL"
    });
    return watchId;
}

function setButtonState(button, text, disabled) {
    button.textContent = text;
    button.disabled = disabled;
    debug("Button state changed", { text, disabled });
}

function createDownloadButton(watchId) {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.dataset.watchId = watchId;
    button.textContent = "Fetch from Redgifs & download";
    button.title = "Sends this video's ID to Redgifs to resolve its media URL.";
    button.setAttribute("aria-label", button.title);

    button.addEventListener("click", () => downloadVideo(button));
    debug("Download button created", { currentId: watchId });
    return button;
}

async function downloadVideo(button) {
    const watchId = getCurrentWatchId();
    if (!watchId) {
        console.error(`${LOG_PREFIX} Button has no watch ID`);
        return;
    }
    button.dataset.watchId = watchId;

    debug("Download requested", { currentId: watchId });
    setButtonState(button, "Finding video...", true);

    try {
        const resolveMessage = { action: "resolveRedgifs", watchId };
        const resolved = await browser.runtime.sendMessage(resolveMessage);
        debug("Media resolved", { currentId: watchId, mediaUrl: resolved?.url });
        if (!resolved?.ok || !resolved.url) {
            throw new Error(resolved?.error || "No downloadable video was found");
        }

        setButtonState(button, "Starting download...", true);
        const downloadMessage = {
            action: "download",
            url: resolved.url,
            watchId
        };
        const result = await browser.runtime.sendMessage(downloadMessage);
        debug("Download response", { currentId: watchId, ok: result?.ok });
        if (!result?.ok) {
            throw new Error(result?.error || "Firefox could not start the download");
        }

        DownloadDialog.show("Download started", "success");
        setButtonState(button, "Download started", false);
    } catch (error) {
        console.error(`${LOG_PREFIX} Download failed`, error);
        debug("Download error", { watchId, error });
        DownloadDialog.show(error.message || "Download failed", "error");
        setButtonState(button, "Download failed", false);
        window.setTimeout(() => {
            setButtonState(button, "Fetch from Redgifs & download", false);
        }, 2500);
    }
}

function addDownloadButton() {
    const watchId = getCurrentWatchId();
    const existingButton = document.getElementById(BUTTON_ID);

    if (existingButton) {
        if (watchId) existingButton.dataset.watchId = watchId;
        return;
    }
    if (!watchId) return;

    document.documentElement.appendChild(createDownloadButton(watchId));
}

// Redgifs can build or replace page content after the initial page load.
addDownloadButton();
let updateScheduled = false;
function scheduleButtonUpdate() {
    if (updateScheduled) return;
    updateScheduled = true;
    window.requestAnimationFrame(() => {
        updateScheduled = false;
        addDownloadButton();
    });
}

function hasVideoOrCard(node) {
    return node.nodeType === Node.ELEMENT_NODE &&
        (node.matches("video,[data-feed-item-id],.GifPreview_isActive") ||
            node.querySelector("video,[data-feed-item-id],.GifPreview_isActive"));
}

new MutationObserver(mutations => {
    if (mutations.some(mutation =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(hasVideoOrCard) ||
        (mutation.type === "attributes" && hasVideoOrCard(mutation.target))
    )) {
        scheduleButtonUpdate();
    }
}).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-feed-item-id", "src"]
});
