const DEBUG = false;
const LOG_PREFIX = "[Reddit Media Downloader Background]";

const debug = ExtensionDebug.create(DEBUG, LOG_PREFIX);

// Media is only downloaded from these domains and their subdomains.
const ALLOWED_MEDIA_DOMAINS = ["redd.it", "redgifs.com", "i.imgur.com"];

IsolatedDownloader.removeStaleContainers().catch(error =>
    debug("Stale container cleanup failed", { error: errorMessage(error) }));

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
    const { response, text } = await RedgifsResolver.fetchText(url, options);

    if (!response.ok && text.startsWith("<")) {
        throw new Error(`Reddit returned HTTP ${response.status}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        const retry = await RedgifsResolver.fetchText(url, {
            credentials: "include"
        });
        if (!retry.response.ok) {
            throw new Error(`Reddit returned HTTP ${retry.response.status}`);
        }
        parsed = JSON.parse(retry.text);
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

// Files from a post share a "<subreddit>_<postId>" prefix so they are easy to
// find and so a video and its audio track can be paired.
function makeNamePrefix(post) {
    const safe = value => String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "");
    return [safe(post.subreddit), safe(post.id)].filter(Boolean).join("_") || "reddit";
}

function extractMedia(post) {
    const media = extractPostMedia(post);
    return media ? { ...media, namePrefix: makeNamePrefix(post) } : null;
}

function extractPostMedia(post) {
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

function getOriginalName(url) {
    return url.split("?")[0].split("/").pop();
}

function getExtension(url) {
    const match = getOriginalName(url).match(/\.([A-Za-z0-9]+)$/);
    return match ? match[1].toLowerCase() : "bin";
}

// Downloads all files in one isolated container.
async function downloadFiles(files) {
    const items = await Promise.all(files.map(async ({ url, filename }) => ({
        url: RedgifsResolver.upgradeHttpUrl(url),
        filename: await DownloadSettings.applyFolder(filename)
    })));
    const downloadIds = await IsolatedDownloader.downloadAll(items, {
        allowedDomains: ALLOWED_MEDIA_DOMAINS
    });
    return { ok: true, downloadIds };
}

function getRedditVideoBaseUrl(fallbackUrl) {
    const videoUrl = new URL(fallbackUrl);
    return new URL(".", videoUrl).href;
}

async function findRedditHlsResources(baseUrl) {
    const masterUrl = new URL("HLSPlaylist.m3u8", baseUrl).href;
    const { response: masterResponse, text: masterPlaylist } =
        await RedgifsResolver.fetchText(masterUrl);
    if (!masterResponse.ok) {
        throw new Error(`Reddit HLS playlist returned HTTP ${masterResponse.status}`);
    }

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
            const { response, text: playlist } =
                await RedgifsResolver.fetchText(audioPlaylistUrl);
            if (!response.ok) continue;

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
    const prefix = media.namePrefix;

    debug("Selected Reddit HLS renditions", { videoQuality, audioQuality });
    return downloadFiles([
        { url: videoUrl, filename: `${prefix}_HLS_${videoQuality}.ts` },
        { url: audioUrl, filename: `${prefix}_${getOriginalName(audioUrl)}` }
    ]);
}

async function startDownload(media) {
    debug("startDownload media", media);
    if (media.type === "gallery") {
        if (!Array.isArray(media.items) || media.items.length === 0) {
            throw new Error("Gallery contains no downloadable items");
        }

        const prefix = media.namePrefix;
        const digits = String(media.items.length).length;
        return downloadFiles(media.items.map((url, index) => ({
            url,
            filename: `${prefix}_${String(index + 1).padStart(Math.max(2, digits), "0")}` +
                `.${getExtension(url)}`
        })));
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
            return await downloadFiles([{ url, filename }]);
        } catch (redgifsError) {
            if (typeof media.fallbackUrl !== "string" || !media.fallbackUrl) {
                throw redgifsError;
            }

            debug("Redgifs download failed; using Reddit fallback URL", {
                error: errorMessage(redgifsError)
            });
            debug("fallback url", media.fallbackUrl);
            return downloadFiles([{ url: media.fallbackUrl, filename }]);
        }
    } else if (media.type === "image") {
        filename = `${media.namePrefix}.${getExtension(url)}`;
    } else {
        filename = `${media.namePrefix}_${getOriginalName(url)}`;
    }

    return downloadFiles([{ url, filename }]);
}

// The content script only sends a post ID; the media URLs are looked up and
// downloaded here, so nothing from the page side decides what gets downloaded.
async function downloadPost(postId) {
    const media = extractMedia(await fetchPostJson(postId));
    if (!media) throw new Error("No downloadable media found in this post");
    return startDownload(media);
}

browser.runtime.onMessage.addListener(message => {
    if (message.action === "downloadPost") {
        return downloadPost(message.postId)
            .catch(error => ({ ok: false, error: errorMessage(error) }));
    }
    debug("Unknown message", { action: message.action });
    return undefined;
});
