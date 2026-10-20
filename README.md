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
package.json               defines `npm test` and the web-ext dependency
scripts/build.ps1          stage, test, lint and zip the extensions
scripts/sign.ps1           sign the built extensions through addons.mozilla.org
scripts/commit.ps1         commit, tag and push
scripts/common.ps1         helpers shared by the three scripts (not run directly)
.env                       AMO signing credentials (not in git, see Signing)
build/                     generated unpacked extensions (not in git)
archives/                  built .zip and signed .xpi files (not in git)
```

The extension folders do not contain `shared/` or `options.html`: the build
script assembles a complete, loadable copy of each extension in
`build/<extension>/`. Edit files in the extension folders and in `shared/`,
never in `build/`, which is replaced on every run.

## Requirements

- [PowerShell 7](https://learn.microsoft.com/powershell/) (`pwsh`) for the
  scripts in `scripts/`.
- [Node.js](https://nodejs.org/) 22 or later for the tests.
- [web-ext](https://github.com/mozilla/web-ext) for linting, building and
  signing: run `npm install` once to install the version from
  `package.json`. The scripts use that copy, or a global `web-ext` if
  `node_modules/` is missing.
- git, for `commit.ps1`.

## Shared sources

Each file in `shared/` has a specific role:

- `debug.js` — small development and troubleshooting helpers. It centralizes
  debug logging and can be used to emit extra console output when diagnosing
  extension behavior without changing the main flow.
- `redgifs-resolver.js` — resolves a Redgifs video ID to a downloadable media
  URL. It also provides the HTTP helpers both extensions use for every
  request: `fetchText` (the 15-second timeout also covers reading the
  response) and `fetchWithTimeout` (for requests whose body is not read).
  Both upgrade HTTP to HTTPS and send no cookies unless asked to.
- `download-dialog.js` — shows a short-lived toast on the page to report
  whether a download started or failed. Only one toast is visible at a time.
- `download-options.js` — wires up the settings page (`options.html`): it loads
  the stored download folder, validates the entered value with
  `download-settings.js`, and saves it to browser storage.
- `download-settings.js` — validates and normalizes the chosen folder name.
  It rejects absolute paths, `..` traversal attempts, and invalid Windows path
  components before the path is stored or used.
- `download-buttons.css` — the page buttons: the Reddit button under each post
  (Reddit orange) and the floating Redgifs button (Redgifs red). The toast
  and the settings page carry their own styles.
- `isolated-download.js` — downloads through a temporary container (an
  isolated cookie store) so the normal browsing session is not sent to media
  hosts. All files from one click share one container, which is removed when
  they finish; leftover containers are removed when the extension starts.
  Each extension passes the list of domains it may download from, and any
  other URL is refused before a download starts.
- `options-theme.js` — the settings page's theme (same as system, light or
  dark), saved in browser storage.
- `options.template.html` — the settings page. The build fills in each
  extension's name and example folder to produce its `options.html`.

## Development

Assemble both extensions without testing or archiving:

```powershell
pwsh -File ./scripts/build.ps1 -StageOnly
```

Then load `build/<extension>/manifest.json` from
`about:debugging#/runtime/this-firefox` (**Load Temporary Add-on**). After
editing, run the command again and click **Reload** in `about:debugging`.

Alternatively, `web-ext run --source-dir "build/Reddit Media Downloader"`
starts a separate Firefox profile with the extension and reloads it whenever
the staged files change, that is, each time you run `-StageOnly` again.

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
- `isolated-download.test.js` — container creation and cleanup, and the
  allowed-domain check.
- `reddit-background.test.js` — the `downloadPost` message, Reddit media
  detection and file names.
- `redgifs-background.test.js` — the Redgifs `download` message.

To add a test, copy an existing `test(...)` block, change the input, and state
the expected result with `assert.equal` or `assert.deepEqual`. Wrap values
returned from the sandbox in `plain(...)` before `assert.deepEqual`.

## Scripts

Each script prints its parameters, the combinations it accepts and examples
with `-Help` (or `Get-Help ./scripts/<name>.ps1 -Full` from a PowerShell
prompt). PowerShell rejects invalid combinations, such as `-Major -Minor`,
before anything runs. A release is the three scripts in order:

```powershell
pwsh -File ./scripts/build.ps1 -Target Reddit -Minor
pwsh -File ./scripts/sign.ps1 -Target Reddit
pwsh -File ./scripts/commit.ps1 -Tag -Target Reddit -Push
```

### Build and validation: `build.ps1`

`pwsh -File ./scripts/build.ps1` builds both extensions. The tests run once
first (`-SkipTests` skips them). Then, for each extension, the script stages
`build/<extension>/`, runs `web-ext lint` (stopping on errors), and zips the
staged copy with `web-ext build`. `-Target Reddit` or `-Target Redgifs` builds
only one; `Both` is the default. `-StageOnly` only stages (see Development).

The script reads each extension's version from its `manifest.json`. To bump
it, target exactly one extension and pass one switch:

```powershell
pwsh -File ./scripts/build.ps1 -Target Reddit -Major
pwsh -File ./scripts/build.ps1 -Target Redgifs -Minor
```

`-Major` increments the first numeric component and resets later components
to zero. `-Minor` increments the second component and resets any later
components to zero. Only the selected extension's manifest is changed.

Archives are written to:

```text
archives/<extension>/<version>_<yyyy-MM-dd>/<archive-name>.zip
```

For each extension, `archives/<extension>/latest` links to the most recently
built version/date directory: a directory junction on Windows, a symbolic link
elsewhere.

### Signing: `sign.ps1`

`pwsh -File ./scripts/sign.ps1 -Target Reddit` submits the staged extension to
addons.mozilla.org as an **unlisted** (self-distributed) version and saves the
signed `.xpi` in `archives/<extension>/latest/`, next to the `.zip`.

It refuses to sign when `build/<extension>/` is missing or differs from the
sources, or when the latest archive was built for another version, so what is
signed is what `build.ps1` tested. AMO refuses a version number it has already
signed, so bump the version with `build.ps1` before signing again.

Create the key and secret at
<https://addons.mozilla.org/developers/addon/api/key/> and put them in a `.env`
file at the repository root:

```text
WEB_EXT_API_KEY=user:12345:67
WEB_EXT_API_SECRET=...
```

The script reads `.env` at startup (blank lines and `#` comments are skipped,
quotes around values are removed) and sets the variables for that run only.
Variables already set in the environment win over `.env`. `.env` is listed in
`.gitignore`; never commit it.

### Git: `commit.ps1`

The repository covers both extensions, `shared/`, the tests and the scripts.
`build/` and `archives/` are ignored; keep signed `.xpi` files elsewhere too
(for example as GitHub release assets), because ignored files are not backed
up by git.

`commit.ps1` stages every change in the repository and commits it, so check
`git status` first:

```powershell
pwsh -File ./scripts/commit.ps1 -Message "Fix crosspost galleries"
pwsh -File ./scripts/commit.ps1 -Tag -Target Reddit -Push
```

`-Message` is required for a plain commit. `-Tag` adds an annotated tag named
after each selected extension's current version (`reddit-v1.3`,
`redgifs-v1.2`) and makes `-Message` optional, defaulting to
`Release Reddit Media Downloader 1.3`. An existing tag is left unchanged.
`-Push` pushes the current branch and its tags to `origin`.
