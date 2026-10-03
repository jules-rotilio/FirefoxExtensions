// Download through a temporary contextual identity so the request uses an isolated
// cookie store and does not leak the normal browsing session into the media download.
const IsolatedDownloader = (() => {
    async function download(url, filename) {
        const identity = await browser.contextualIdentities.create({
            name: `Extension download ${Date.now()}-${Math.random().toString(36).slice(2)}`,
            color: "blue",
            icon: "briefcase"
        });

        let downloadId;
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
        const onChanged = delta => {
            if (delta.id === downloadId &&
                ["complete", "interrupted"].includes(delta.state?.current)) {
                cleanup();
            }
        };

        browser.downloads.onChanged.addListener(onChanged);
        try {
            downloadId = await browser.downloads.download({
                url,
                filename,
                saveAs: false,
                cookieStoreId: identity.cookieStoreId
            });

            const [item] = await browser.downloads.search({ id: downloadId });
            if (item && ["complete", "interrupted"].includes(item.state)) {
                await cleanup();
            }
            return downloadId;
        } catch (error) {
            await cleanup();
            throw error;
        }
    }

    return { download };
})();