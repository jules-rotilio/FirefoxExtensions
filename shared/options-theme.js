// Light/dark theme for the settings page. The choice is saved in browser storage;
// a localStorage copy is read synchronously so the page does not flash on load.
const OptionsTheme = (() => {
    const STORAGE_KEY = "theme";
    const THEMES = ["system", "light", "dark"];

    function normalize(value) {
        return THEMES.includes(value) ? value : "system";
    }

    function apply(theme) {
        theme = normalize(theme);
        if (theme === "system") {
            delete document.documentElement.dataset.theme;
        } else {
            document.documentElement.dataset.theme = theme;
        }
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            // localStorage is only a cache; browser storage holds the setting.
        }
        return theme;
    }

    try {
        apply(localStorage.getItem(STORAGE_KEY));
    } catch {
        // Fall through to browser storage below.
    }

    const loaded = browser.storage.local.get(STORAGE_KEY)
        .then(stored => apply(stored[STORAGE_KEY]))
        .catch(() => "system");

    document.addEventListener("DOMContentLoaded", async () => {
        const select = document.querySelector("#theme");
        if (!select) return;
        select.value = await loaded;
        select.addEventListener("change", async () => {
            const theme = apply(select.value);
            await browser.storage.local.set({ [STORAGE_KEY]: theme });
        });
    });

    return { apply, normalize };
})();
