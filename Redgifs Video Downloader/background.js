const DEBUG = false;
const LOG_PREFIX = "[Redgifs Downloader]";

const debug = ExtensionDebug.create(DEBUG, LOG_PREFIX);

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

IsolatedDownloader.removeStaleContainers().catch(error =>
    debug("Stale container cleanup failed", { error: errorMessage(error) }));

// Media is only downloaded from Redgifs and its subdomains.
const ALLOWED_MEDIA_DOMAINS = ["redgifs.com"];

// The content script only sends a watch ID; the video URL is resolved and
// downloaded here, so nothing from the page side decides what gets downloaded.
async function downloadVideo(watchId) {
    if (typeof watchId !== "string" || !/^[A-Za-z0-9]+$/.test(watchId)) {
        throw new Error("Invalid Redgifs video ID");
    }
    const url = await RedgifsResolver.resolve(watchId);
    const filename = await DownloadSettings.applyFolder(`${watchId}.mp4`);
    const downloadId = await IsolatedDownloader.download(
        RedgifsResolver.upgradeHttpUrl(url),
        filename,
        { allowedDomains: ALLOWED_MEDIA_DOMAINS }
    );
    return { ok: true, downloadId };
}

browser.runtime.onMessage.addListener(message => {
    if (message.action === "download") {
        return downloadVideo(message.watchId)
            .catch(error => ({
                ok: false,
                error: errorMessage(error)
            }));
    }

    debug("Unknown message", { action: message.action });
    return undefined;
});
