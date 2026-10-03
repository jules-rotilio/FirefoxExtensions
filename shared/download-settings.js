// Normalizes and validates the folder chosen for downloads.
// This keeps the path relative to Firefox's managed downloads directory and blocks
// unsafe Windows names or traversal like "../" that would be confusing or dangerous.
const DownloadSettings = (() => {
    const STORAGE_KEY = "downloadFolder";
    const DEFAULT_FOLDER = "media_folder";

    function normalizeFolder(value) {
        if (typeof value !== "string") {
            throw new Error("Download folder must be a path");
        }

        const path = value.trim().replace(/\\/g, "/");
        if (!path) return "";
        if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
            throw new Error("Use a path relative to the browser's download folder");
        }

        const segments = path.split("/").filter(segment => segment && segment !== ".");
        if (segments.some(segment => segment === "..")) {
            throw new Error("Parent-folder references are not allowed");
        }
        if (segments.some(segment =>
            /[<>:\"|?*\u0000-\u001f]/.test(segment) ||
            /[. ]$/.test(segment) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
        )) {
            throw new Error("The folder path contains a name that is not portable");
        }

        return segments.join("/");
    }

    async function getFolder() {
        const stored = await browser.storage.local.get(STORAGE_KEY);
        return normalizeFolder(stored[STORAGE_KEY] ?? DEFAULT_FOLDER);
    }

    async function applyFolder(filename) {
        const folder = await getFolder();
        return folder ? `${folder}/${filename}` : filename;
    }

    return { DEFAULT_FOLDER, getFolder, normalizeFolder, applyFolder };
})();