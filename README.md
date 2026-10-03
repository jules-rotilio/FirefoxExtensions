# Firefox Extensions

This workspace contains the Reddit Media Downloader and Redgifs Video
Downloader Firefox extensions. Each extension has its own README with
extension-specific behavior and setup instructions:

- [Reddit Media Downloader](Reddit%20Media%20Downloader/README.md)
- [Redgifs Video Downloader](Redgifs%20Video%20Downloader/README.md)

## Layout

```text
Reddit Media Downloader/   extension-specific source (manifest, scripts, icon, README)
Redgifs Video Downloader/  extension-specific source
shared/                    code and settings page used by both extensions
tests/                     automated tests (Node's built-in test runner)
build.ps1                  stage, test, lint, build, sign, commit and push
build/                     generated unpacked extensions (not in git)
archives/                  built .zip and signed .xpi files (not in git)
```

The extension folders do not contain `shared/` or `options.html`: the build
script assembles a complete, loadable copy of each extension in
`build/<extension>/`. Edit files in the extension folders and in `shared/`,
never in `build/`, which is replaced on every run.

## Shared sources

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
- `isolated-download.js` — downloads through a temporary container (an
  isolated cookie store) so the normal browsing session is not sent to media
  hosts. All files from one click share one container, which is removed when
  they finish; leftover containers are removed when the extension starts.
- `options-theme.js` — the settings page's light/dark theme, saved in browser
  storage.
- `options.template.html` — the settings page. The build fills in each
  extension's name and example folder to produce its `options.html`.

## Development

Assemble both extensions without testing or archiving:

```powershell
pwsh -File ./build.ps1 -StageOnly
```

Then load `build/<extension>/manifest.json` from
`about:debugging#/runtime/this-firefox` (**Load Temporary Add-on**). After
editing, run the command again and click **Reload** in `about:debugging`.

Alternatively, `web-ext run --source-dir "build/Reddit Media Downloader"`
starts a separate Firefox profile with the extension and reloads it whenever
the staged files change.

## Tests

```sh
npm test
```

This runs `node --test` on `tests/*.test.js`; no packages need to be
installed. The tests load the extension scripts into a sandbox with fake
`browser`, `fetch` and `DOMParser` objects defined in `tests/helpers.js`, so
they run without Firefox or network access. Each test file covers one area:

- `download-settings.test.js` — folder validation and storage.
- `redgifs-resolver.test.js` — the Redgifs source order and fallbacks.
- `isolated-download.test.js` — container creation and cleanup.
- `reddit-background.test.js` — Reddit media detection and file names.

To add a test, copy an existing `test(...)` block, change the input, and state
the expected result with `assert.equal` or `assert.deepEqual`. Wrap values
returned from the sandbox in `plain(...)` before `assert.deepEqual`.

## Build archives

Run `pwsh -File ./build.ps1` from this directory to build both
extensions. For each extension the script stages `build/<extension>/`, runs
`web-ext lint` (stopping on errors), and zips the staged copy with
`web-ext build`. The tests run once before the extensions are built; pass
`-SkipTests` to skip them. To build only one extension, pass a target:

```powershell
pwsh -File ./build.ps1 -Target Reddit
pwsh -File ./build.ps1 -Target Redgifs
```

The accepted targets are `Reddit`, `Redgifs`, and `Both`. `Both` is the
default. The script reads each extension's version from its `manifest.json`.

To bump a version, target exactly one extension and pass one switch:

```powershell
pwsh -File ./build.ps1 -Target Reddit -Major
pwsh -File ./build.ps1 -Target Redgifs -Minor
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

## Signing

`-Sign` submits each built extension to addons.mozilla.org as an **unlisted**
(self-distributed) version and saves the signed `.xpi` next to the `.zip`:

```powershell
pwsh -File ./build.ps1 -Target Reddit -Minor -Sign
```

Create the key and secret at
<https://addons.mozilla.org/developers/addon/api/key/> and put them in a `.env`
file next to this script:

```text
WEB_EXT_API_KEY=user:12345:67
WEB_EXT_API_SECRET=...
```

The script reads `.env` at startup (blank lines and `#` comments are skipped,
quotes around values are removed) and sets the variables for that run only.
Variables already set in the environment win over `.env`. `.env` is listed in
`.gitignore`; never commit it. AMO refuses a
version number it has already signed, so bump the version before signing
again.

## Git

The repository covers both extensions, `shared/`, the tests and this script.
`build/` and `archives/` are ignored; keep signed `.xpi` files elsewhere too
(for example as GitHub release assets), because ignored files are not backed
up by git.

`-Commit` stages every change in the repository, commits it, and adds an
annotated tag per built extension (`reddit-v1.3`, `redgifs-v1.2`). An existing
tag is left unchanged. `-Message` replaces the default commit message
(`Build Reddit Media Downloader 1.3`). `-Push` pushes the current branch and its
tags to `origin`:

```powershell
pwsh -File ./build.ps1 -Target Redgifs -Minor -Sign -Commit -Push
```

Because `-Commit` includes all changes, check `git status` first.
