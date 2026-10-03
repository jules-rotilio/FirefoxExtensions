const DEBUG = false;
const LOG_PREFIX = "[Redgifs Downloader]";

const debug = ExtensionDebug.create(DEBUG, LOG_PREFIX);

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

browser.runtime.onMessage.addListener(message => {
    if (message.action === "resolveRedgifs") {
        return RedgifsResolver.resolve(message.watchId)
            .then(url => ({ ok: true, url }))
            .catch(error => ({
                ok: false,
                error: errorMessage(error)
            }));
    }

    if (message.action === "download") {
        return DownloadSettings.applyFolder(`${message.watchId}.mp4`)
            .then(filename => IsolatedDownloader.download(
                RedgifsResolver.upgradeHttpUrl(message.url),
                filename
            ))
            .then(downloadId => ({ ok: true, downloadId }))
            .catch(error => ({
                ok: false,
                error: errorMessage(error)
            }));
    }

    debug("Unknown message", { action: message.action });
    return undefined;
});
