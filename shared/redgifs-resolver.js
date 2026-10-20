// Resolve a Redgifs watch page to a direct media URL that can be downloaded.
// The code tries the HLS playlist first and then falls back to the page metadata.
const RedgifsResolver = (() => {
    const WATCH_PAGE_URL = id => `https://www.redgifs.com/watch/${id}`;
    const HLS_PLAYLIST_URL = id =>
        `https://api.redgifs.com/v2/gifs/${id.toLowerCase()}/hd.m3u8`;
    const MEDIA_MP4_PATTERN =
        /https:\/\/media\.redgifs\.com\/[A-Za-z0-9_-]+\.mp4(?:\?[^"'\s<]*)?/i;
    const HLS_MAP_URI_PATTERN = /URI="([^"]+)"/i;

    // Ensure incoming URLs are HTTPS so the fetch stays compatible with browser rules.
    function upgradeHttpUrl(value) {
        const url = new URL(value);
        if (url.protocol === "http:") url.protocol = "https:";
        if (url.protocol !== "https:") {
            throw new Error("Only HTTPS media URLs are supported");
        }
        return url.href;
    }

    // Abort slow requests instead of letting browser requests hang forever.
    // With readText, the timeout also covers reading the body, so a server that
    // stalls halfway through a response cannot hang the request either.
    async function request(url, options, timeout, readText) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(upgradeHttpUrl(url), {
                ...options,
                credentials: options.credentials ?? "omit",
                signal: controller.signal
            });
            const text = readText ? await response.text() : null;
            return { response, text };
        } finally {
            clearTimeout(timer);
        }
    }

    // For requests whose body is not needed, such as HEAD requests.
    async function fetchWithTimeout(url, options = {}, timeout = 15000) {
        return (await request(url, options, timeout, false)).response;
    }

    // Resolves with { response, text }.
    function fetchText(url, options = {}, timeout = 15000) {
        return request(url, options, timeout, true);
    }

    function findHlsMediaUrl(playlist, playlistUrl) {
        const match = playlist.match(HLS_MAP_URI_PATTERN);
        return match ? new URL(match[1], playlistUrl).href : null;
    }

    function findOpenGraphVideo(html) {
        const parsedPage = new DOMParser().parseFromString(html, "text/html");
        return parsedPage.querySelector('meta[property="og:video"]')?.content || null;
    }

    // Some Redgifs URLs expose a "-silent" variant that is not usable for download.
    function removeSilentSuffix(url) {
        return url.replace(/-silent(?=\.mp4(?:\?|$))/i, "");
    }

    // Redgifs keeps listing deleted videos in their playlist, but the media file
    // itself then answers 403 or 404. A HEAD request checks this without
    // downloading anything; a network error counts as missing.
    async function mediaExists(url) {
        try {
            const response = await fetchWithTimeout(url, {
                method: "HEAD",
                headers: { "User-Agent": navigator.userAgent }
            }, 5000);
            return response.ok;
        } catch {
            return false;
        }
    }

    async function firstExistingMedia(urls) {
        for (const url of new Set(urls.filter(Boolean))) {
            if (await mediaExists(url)) return url;
        }
        return null;
    }

    async function fetchPlaylistMedia(watchId) {
        const playlistUrl = HLS_PLAYLIST_URL(watchId);
        const { response, text } = await fetchText(playlistUrl, {
            headers: { "User-Agent": navigator.userAgent }
        });
        if (!response.ok) return null;
        return findHlsMediaUrl(text, response.url || playlistUrl);
    }

    async function fetchWatchPageMedia(watchId) {
        const { response, text: html } = await fetchText(WATCH_PAGE_URL(watchId), {
            headers: { "User-Agent": navigator.userAgent }
        });
        if (response.status === 404 || response.status === 410) {
            throw new Error("This Redgifs video no longer exists");
        }
        if (!response.ok) {
            throw new Error(`Redgifs returned HTTP ${response.status}`);
        }

        const directMatch = html.match(MEDIA_MP4_PATTERN)?.[0];
        const openGraphVideo = findOpenGraphVideo(html);

        // Prefer the non-silent variant when the page exposes it, otherwise fall back.
        return firstExistingMedia([
            openGraphVideo && removeSilentSuffix(openGraphVideo),
            directMatch,
            openGraphVideo
        ]);
    }

    // Resolves with a media URL that was checked to exist, or rejects.
    async function resolve(watchId) {
        let playlistMedia = null;
        try {
            playlistMedia = await fetchPlaylistMedia(watchId);
        } catch {
            // The watch-page fallbacks are intentionally tried next.
        }
        if (playlistMedia && await mediaExists(playlistMedia)) return playlistMedia;

        const watchPageMedia = await fetchWatchPageMedia(watchId);
        if (!watchPageMedia) {
            throw new Error(playlistMedia
                ? "This Redgifs video is no longer available"
                : "Redgifs did not expose a downloadable media URL");
        }
        return watchPageMedia;
    }

    return { fetchText, fetchWithTimeout, mediaExists, resolve, upgradeHttpUrl };
})();
