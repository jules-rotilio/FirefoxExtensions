const DEBUG = false;
const LOG_PREFIX = "[Reddit Media Downloader Background]";

const debug = ExtensionDebug.create(DEBUG, LOG_PREFIX);

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

async function fetchPostJson(postId) {
    if (typeof postId !== "string" || !/^[A-Za-z0-9]+$/.test(postId)) {
        throw new Error("Invalid Reddit post ID");
    }

    const url = `https://www.reddit.com/comments/${postId}.json`;
    const options = {
        credentials: "include",
        headers: { "Accept": "application/json" }
    };
    const response = await RedgifsResolver.fetchWithTimeout(url, options);
    const text = await response.text();

    if (!response.ok && text.startsWith("<")) {
        throw new Error(`Reddit returned HTTP ${response.status}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        const retry = await RedgifsResolver.fetchWithTimeout(url, {
            credentials: "include"
        });
        if (!retry.ok) throw new Error(`Reddit returned HTTP ${retry.status}`);
        parsed = await retry.json();
    }

    const post = parsed?.[0]?.data?.children?.[0]?.data;
    if (!post) throw new Error("Reddit returned no post data");
    return post;
}

function extractGallery(post) {
    const { gallery_data, media_metadata } = post;
    if (!gallery_data || !media_metadata) return null;

    const items = gallery_data.items.map(item => {
        const meta = media_metadata[item.media_id];
        if (!meta?.m) return null;
        return `https://i.redd.it/${item.media_id}.${meta.m.split("/")[1]}`;
    }).filter(Boolean);
    return { type: "gallery", items };
}

function extractMedia(post) {
    let url = "";
    try {
        url = RedgifsResolver.upgradeHttpUrl(post.url || "");
    } catch {
        // Ignore invalid or non-HTTP media URLs and inspect other post media.
    }
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(url)) return { type: "image", url };

    const videoMetadata = [
        post.secure_media?.reddit_video,
        post.preview?.reddit_video_preview
    ].filter(Boolean);
    const videoUrl = videoMetadata.map(video => {
        try {
            return RedgifsResolver.upgradeHttpUrl(video.fallback_url);
        } catch {
            return null;
        }
    }).find(Boolean);
    if (url.includes("redgifs.com")) {
        return {
            type: "redgifs",
            url,
            fallbackUrl: videoUrl || null
        };
    }
    if (videoUrl) {
        return {
            type: "video",
            url: videoUrl,
            hasAudio: videoMetadata.some(video => video.has_audio === true)
        };
    }
    return post.gallery_data && post.media_metadata ? extractGallery(post) : null;
}

function makeTimestamp() {
    const d = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function getFilename(url, type) {
    const original = url.split("?")[0].split("/").pop().toLowerCase();
    return type === "video"
        ? `${makeTimestamp()}_${original}`
        : original;
}

async function downloadUrl(url, filename) {
    url = RedgifsResolver.upgradeHttpUrl(url);
    filename = await DownloadSettings.applyFolder(filename);
    const downloadId = await IsolatedDownloader.download(url, filename);
    return { ok: true, downloadId };
}

function getRedditVideoBaseUrl(fallbackUrl) {
    const videoUrl = new URL(fallbackUrl);
    return new URL(".", videoUrl).href;
}

async function findRedditHlsResources(baseUrl) {
    const masterUrl = new URL("HLSPlaylist.m3u8", baseUrl).href;
    const masterResponse = await RedgifsResolver.fetchWithTimeout(masterUrl);
    if (!masterResponse.ok) {
        throw new Error(`Reddit HLS playlist returned HTTP ${masterResponse.status}`);
    }

    const masterPlaylist = await masterResponse.text();
    const videoQualities = [...masterPlaylist.matchAll(/HLS_(\d+)\.m3u8/gi)]
        .map(match => Number(match[1]))
        .filter(Number.isFinite);
    if (videoQualities.length === 0) {
        throw new Error("Reddit HLS playlist did not list any video renditions");
    }
    const videoQuality = Math.max(...videoQualities);

    const audioQualities = [...masterPlaylist.matchAll(/HLS_AUDIO_(\d+)\.m3u8/gi)]
        .map(match => Number(match[1]))
        .filter(Number.isFinite);
    const sortedQualities = [...new Set(audioQualities)].sort((left, right) => right - left);
    if (sortedQualities.length === 0) {
        throw new Error("Reddit HLS playlist did not list any audio tracks");
    }

    for (const quality of sortedQualities) {
        const audioPlaylistUrl = new URL(`HLS_AUDIO_${quality}.m3u8`, masterUrl).href;
        try {
            const response = await RedgifsResolver.fetchWithTimeout(audioPlaylistUrl);
            if (!response.ok) continue;

            const playlist = await response.text();
            const audioFile = playlist
                .split(/\r?\n/)
                .map(line => line.trim())
                .find(line => line && !line.startsWith("#") && /\.aac(?:[?#].*)?$/i.test(line));
            if (audioFile) {
                return {
                    videoUrl: new URL(`HLS_${videoQuality}.ts`, baseUrl).href,
                    audioUrl: new URL(audioFile, response.url || audioPlaylistUrl).href,
                    videoQuality,
                    audioQuality: quality
                };
            }
        } catch (error) {
            debug("Reddit audio playlist lookup failed", {
                quality,
                error: errorMessage(error)
            });
        }
    }

    throw new Error("Reddit HLS playlist did not expose a downloadable AAC track");
}

async function downloadRedditVideoWithAudio(media) {
    const baseUrl = getRedditVideoBaseUrl(media.url);
    const { audioUrl, videoUrl, audioQuality, videoQuality } =
        await findRedditHlsResources(baseUrl);
    const timestamp = makeTimestamp();

    debug("Selected Reddit HLS renditions", { videoQuality, audioQuality });
    const results = await Promise.all([
        downloadUrl(videoUrl, `${timestamp}_HLS_${videoQuality}.ts`),
        downloadUrl(
            audioUrl,
            `${timestamp}_${audioUrl.split("/").pop().split("?")[0]}`
        )
    ]);

    return {
        ok: true,
        downloadIds: results.map(result => result.downloadId)
    };
}

async function startDownload(media) {
    debug("startDownload media", media);
    if (media.type === "gallery") {
        if (!Array.isArray(media.items) || media.items.length === 0) {
            throw new Error("Gallery contains no downloadable items");
        }

        const results = await Promise.all(media.items.map(url => {
            if (typeof url !== "string" || !url) {
                throw new Error("Gallery contains an invalid media URL");
            }

            return downloadUrl(url, getFilename(url, "image"));
        }));

        return {
            ok: true,
            downloadIds: results.map(result => result.downloadId)
        };
    }

    if (typeof media?.url !== "string" || !media.url) {
        throw new Error("Media does not contain a downloadable URL");
    }

    if (media.type === "video" && media.hasAudio === true) {
        return downloadRedditVideoWithAudio(media);
    }

    let url = media.url;
    let filename;
    if (media.type === "redgifs") {
        const match = media.url.match(
            /^https:\/\/(?:www\.|v3\.)?redgifs\.com\/watch\/([A-Za-z0-9]+)/i
        );
        if (!match) throw new Error("Invalid Redgifs URL");
        filename = `${match[1]}.mp4`;

        try {
            url = await RedgifsResolver.resolve(match[1]);
            debug("startDownload url", url);
            return downloadUrl(url, filename);
        } catch (redgifsError) {
            if (typeof media.fallbackUrl !== "string" || !media.fallbackUrl) {
                throw redgifsError;
            }

            debug("Redgifs download failed; using Reddit fallback URL", {
                error: errorMessage(redgifsError)
            });
            debug("fallback url", media.fallbackUrl);
            return downloadUrl(media.fallbackUrl, filename);
        }
    } else {
        filename = getFilename(url, media.type);
    }

    return downloadUrl(url, filename);
}

browser.runtime.onMessage.addListener(message => {
    if (message.action === "getPostMedia") {
        return fetchPostJson(message.postId)
            .then(post => ({ ok: true, media: extractMedia(post) }))
            .catch(error => ({ ok: false, error: errorMessage(error) }));
    }
    if (message.action === "downloadMedia") {
        return startDownload(message.media)
            .catch(error => ({ ok: false, error: errorMessage(error) }));
    }
    debug("Unknown message", { action: message.action });
    return undefined;
});
