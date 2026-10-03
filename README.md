# Firefox Extensions

This workspace contains the Reddit Media Downloader and Redgifs Video
Downloader Firefox extensions. Each extension has its own README with
extension-specific behavior and setup instructions:

- [Reddit Media Downloader](Reddit%20Media%20Downloader/README.md)
- [Redgifs Video Downloader](Redgifs%20Video%20Downloader/README.md)

## Shared sources

The canonical shared logger, resolver, status toast, isolated downloader,
download settings, options-page script, and button styles live in `shared/`. The packaging script
copies these files into the selected extension packages before archiving them.

Each file in `shared/` has a specific role:

- `debug.js` — small development and troubleshooting helpers. It centralizes
  debug logging and can be used to emit extra console output when diagnosing
  extension behavior without changing the main flow.
- `redgifs-resolver.js` — resolves Redgifs media URLs, upgrades insecure HTTP
  links to HTTPS, and fetches the final playable source before download.
- `download-dialog.js` — shows a short-lived toast on the page to report
  whether a download started or failed. Only one toast is visible at a time.
- `download-options.js` — wires up the settings page (`options.html`): it loads
  the stored download folder, validates the entered value with
  `download-settings.js`, and saves it to browser storage.
- `download-settings.js` — validates and normalizes the chosen folder name.
  It rejects absolute paths, `..` traversal attempts, and invalid Windows path
  components before the path is stored or used.
- `download-buttons.css` — shared styling for the extension buttons, prompts,
  and popup controls so each package uses the same UI treatment.
- `isolated-download.js` — a helper that triggers downloads using an isolated
  cookie store so the selected media can be downloaded without leaking the
  normal browsing session into the request.

## Build archives

Run `pwsh -File ./make_archives.ps1` from this directory to build both
extensions. To build only one, pass a target:

```powershell
pwsh -File ./make_archives.ps1 -Target Reddit
pwsh -File ./make_archives.ps1 -Target Redgifs
```

The accepted targets are `Reddit`, `Redgifs`, and `Both`. `Both` is the
default. The script reads each extension's version from its `manifest.json`.

To bump a version, target exactly one extension and pass one switch:

```powershell
pwsh -File ./make_archives.ps1 -Target Reddit -Major
pwsh -File ./make_archives.ps1 -Target Redgifs -Minor
```

`-Major` increments the first numeric component and resets later components to
zero. `-Minor` increments the second component and resets any later components
to zero. The script updates only the selected extension's manifest, then builds
the archive in a directory named for the new version and current date. The two
bump switches cannot be used together, and neither can be used with `-Target
Both`.

Archives are written to:

```text
archives/<extension>/<version>_<yyyy-MM-dd>/<archive-name>.zip
```

For each extension, `archives/<extension>/latest` links to the most recently
built version/date directory. The script creates a directory junction on
Windows and a symbolic link on other PowerShell platforms.