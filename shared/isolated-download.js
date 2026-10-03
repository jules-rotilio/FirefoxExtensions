// Download through a temporary contextual identity so the request uses an isolated
// cookie store and does not leak the normal browsing session into the media download.
const IsolatedDownloader = (() => {
    // Containers are named after the extension so each extension only removes its own.
    const CONTAINER_PREFIX = `${browser.runtime.getManifest().name} download `;
    // Name used by versions before the per-extension prefix.
    const LEGACY_CONTAINER_PREFIX = "Extension download ";
    const FINISHED_STATES = ["complete", "interrupted"];

    // Containers left behind when the browser or extension stopped mid-download.
    async function removeStaleContainers() {
        const identities = await browser.contextualIdentities.query({});
        await Promise.all(identities
            .filter(identity =>
                identity.name.startsWith(CONTAINER_PREFIX) ||
                identity.name.startsWith(LEGACY_CONTAINER_PREFIX))
            .map(identity => browser.contextualIdentities
                .remove(identity.cookieStoreId)
                .catch(() => {})));
    }

    // True when the URL is HTTPS and its host is one of the domains or a subdomain.
    function isAllowedUrl(url, allowedDomains) {
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return false;
        }
        return parsed.protocol === "https:" && allowedDomains.some(domain =>
            parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
    }

    // Download every item in one shared container, removed once all downloads finish.
    // Only URLs on allowedDomains (e.g. ["redd.it"], subdomains included) are accepted.
    // Resolves with the download IDs; rejects if any download could not be started.
    async function downloadAll(items, { allowedDomains }) {
        const blocked = items.find(({ url }) => !isAllowedUrl(url, allowedDomains));
        if (blocked) {
            throw new Error(`Refusing to download from ${blocked.url}`);
        }

        const identity = await browser.contextualIdentities.create({
            name: `${CONTAINER_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
            color: "blue",
            icon: "briefcase"
        });

        const pending = new Set();
        let allStarted = false;
        let cleanupTask;
        const cleanup = () => {
            if (!cleanupTask) {
                browser.downloads.onChanged.removeListener(onChanged);
                cleanupTask = browser.contextualIdentities
                    .remove(identity.cookieStoreId)
                    .catch(() => {});
            }
            return cleanupTask;
        };
        const cleanupWhenDone = () => {
            if (allStarted && pending.size === 0) return cleanup();
            return undefined;
        };
        const onChanged = delta => {
            if (pending.has(delta.id) && FINISHED_STATES.includes(delta.state?.current)) {
                pending.delete(delta.id);
                cleanupWhenDone();
            }
        };

        browser.downloads.onChanged.addListener(onChanged);
        try {
            const results = await Promise.allSettled(items.map(({ url, filename }) =>
                browser.downloads.download({
                    url,
                    filename,
                    saveAs: false,
                    cookieStoreId: identity.cookieStoreId
                })));
            const downloadIds = results
                .filter(result => result.status === "fulfilled")
                .map(result => result.value);
            downloadIds.forEach(id => pending.add(id));

            // A download may have finished before its ID was known to onChanged.
            for (const id of downloadIds) {
                const [item] = await browser.downloads.search({ id });
                if (!item || FINISHED_STATES.includes(item.state)) pending.delete(id);
            }
            allStarted = true;
            await cleanupWhenDone();

            const failure = results.find(result => result.status === "rejected");
            if (failure) throw failure.reason;
            return downloadIds;
        } catch (error) {
            allStarted = true;
            await cleanupWhenDone();
            throw error;
        }
    }

    async function download(url, filename, options) {
        const [downloadId] = await downloadAll([{ url, filename }], options);
        return downloadId;
    }

    return { download, downloadAll, removeStaleContainers };
})();
