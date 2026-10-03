// This is the options page wiring for the custom download folder.
// It loads the stored folder on page load and validates/updates it on submit.
document.addEventListener("DOMContentLoaded", async () => {
    const form = document.querySelector("form");
    const input = document.querySelector("#download-folder");
    const status = document.querySelector("#status");

    try {
        input.value = await DownloadSettings.getFolder();
    } catch (error) {
        status.textContent = error.message;
        status.dataset.error = "true";
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        status.textContent = "";
        delete status.dataset.error;

        try {
            const folder = DownloadSettings.normalizeFolder(input.value);
            await browser.storage.local.set({ downloadFolder: folder });
            input.value = folder;
            status.textContent = "Saved";
        } catch (error) {
            status.textContent = error.message;
            status.dataset.error = "true";
        }
    });
});