// Small logging helper used during local troubleshooting.
// Keeping it in a shared module avoids repeating debug scaffolding in each extension.
globalThis.ExtensionDebug = {
    create(enabled, prefix) {
        return (label, values = {}) => {
            if (enabled) console.debug(`${prefix} ${label}`, values);
        };
    }
};
