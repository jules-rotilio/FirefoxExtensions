// Toast-style status dialog used to confirm actions or show an error.
const DownloadDialog = (() => {
    let activeDialog;

    function show(message, color = "default") {
        // Only one message should be visible at a time to avoid stacking popups.
        if (activeDialog) activeDialog.remove();

        const colors = {
            default: "#222",
            success: "#16803c",
            error: "#c62828"
        };
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "alertdialog");
        dialog.textContent = message;
        dialog.style.cssText = [
            "position:fixed", "left:50%", "top:20px",
            "transform:translateX(-50%)", "z-index:2147483647",
            "padding:12px 18px", "border-radius:6px",
            `background:${colors[color] || colors.default}`, "color:#fff", "font:14px sans-serif",
            "box-shadow:0 2px 10px rgb(0 0 0 / 35%)"
        ].join(";");
        document.documentElement.appendChild(dialog);
        activeDialog = dialog;
        window.setTimeout(() => {
            if (activeDialog === dialog) {
                dialog.remove();
                activeDialog = null;
            }
        }, 2000);
    }

    return { show };
})();
