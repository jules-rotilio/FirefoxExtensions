const DEBUG = false;
const LOG_PREFIX = "[Reddit Media Downloader]";

const debug = ExtensionDebug.create(DEBUG, LOG_PREFIX);

function injectButton(postElement, postId) {
    if (postElement.dataset.downloadButtonAdded === "true") return;
    postElement.dataset.downloadButtonAdded = "true";
    const article = postElement.closest("article");
    const btn = document.createElement("button");
    btn.className = "reddit-media-downloader-button";
    btn.textContent = "Fetch from Reddit & download";
    btn.title = "Sends this post's ID to Reddit to retrieve its media details.";
    btn.setAttribute("aria-label", btn.title);

    btn.onclick = async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = "Fetching post from Reddit...";
        try {
            const result = await browser.runtime.sendMessage({
                action: "downloadPost",
                postId
            });
            if (!result?.ok) {
                throw new Error(result?.error || "Media download failed");
            }
            DownloadDialog.show("Download started", "success");
            btn.textContent = "Download started";
            window.setTimeout(() => {
                btn.textContent = "Fetch from Reddit & download";
                btn.disabled = false;
            }, 1500);
        } catch (error) {
            console.error("Media download failed:", error);
            DownloadDialog.show(error.message || "Media download failed", "error");
            btn.textContent = "Download failed";
            window.setTimeout(() => {
                btn.textContent = "Fetch from Reddit & download";
                btn.disabled = false;
            }, 2500);
        }
    };

    if (!article) {
        postElement.appendChild(btn);
    } else {
        postElement.insertAdjacentElement("afterend", btn);
    }
}

const processed = new Set();

const queue = new Set();
let scheduled = false;

function schedulePosts(nodes) {
    nodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches?.("shreddit-post")) queue.add(node);
        node.querySelectorAll?.("shreddit-post").forEach(post => queue.add(post));
    });
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(processPosts);
}

function processPosts() {
    scheduled = false;
    const posts = [...queue];
    queue.clear();
    posts.forEach(post => {
        const id = post.getAttribute("id");
        if (!id?.startsWith("t3_") || processed.has(id) ||
            post.dataset.downloadButtonAdded === "true") return;

        processed.add(id);

        injectButton(post, id.slice(3));
    });
}

const observer = new MutationObserver(mutations => {
    schedulePosts(mutations.flatMap(mutation => [...mutation.addedNodes]));
});

observer.observe(document.body, { childList: true, subtree: true });
schedulePosts([document.body]);
