# Redgifs Video Downloader

Firefox extension, companion to the Reddit Media Downloader (both share the
same resolver and download code). It adds a floating **Fetch from Redgifs &
download** button to Redgifs pages (watch, feed and niche pages) and saves
videos in the folder configured in the extension settings. By default, files
go into `media_folder/` inside Firefox's configured download directory.

Click the extension's toolbar button to open its settings popup, or open the
extension's settings from Firefox's Add-ons Manager. Choose any relative folder;
nested paths can use either `/` or `\`. Leave the setting empty to use Firefox's
download directory directly. Absolute paths are not supported because Firefox
controls the base download directory. The settings page also has a theme
choice (same as system, light or dark), which is remembered.

Firefox's data disclosure lists browsing activity and website content. Only
after you click the button does the extension send the selected video ID to
Redgifs over HTTPS to resolve and download that video. Media downloads run in
a temporary empty cookie store, which is removed once the download finishes;
stores left behind when Firefox closes during a download are removed the next
time the extension starts. The `cookies` and `contextualIdentities`
permissions are used only to create these stores; the extension does not read
cookie values.

The resolver uses this source order:

1. Fetch the Redgifs HD HLS playlist.
2. Extract the first `URI="..."` value and download that `.m4s` resource as
   an `.mp4` file.
3. Fall back to the watch page's `og:video` metadata, preferring the URL
   without `-silent`.
4. Fall back to the first `media.redgifs.com/….mp4` URL found in the page.
   Because the `og:video` URL is itself such a link, this step only finds
   something new when the page has no `og:video` tag.
5. Fall back to the original `og:video` URL, including `-silent` when that is
   the only available asset.

Each candidate is checked with a `HEAD` request before it is used, and skipped
if it does not exist: Redgifs keeps serving the playlist of a deleted video,
but its media file then answers 403. If the watch page answers 404 or 410, the
video is reported as no longer existing instead of downloading a missing file.

The HLS playlist does not need to contain an `.mp4` URL. A playlist containing
an `.m4s` URI is a fragmented MP4 resource; the extension downloads the
underlying resource directly and names the result `<watch-id>.mp4`.

The button is shown while a video is detected and hidden otherwise. When
clicked, it sends only the video ID; the background script resolves and
downloads the video, and only from `redgifs.com` and its subdomains. After a
download starts or fails, the button shows the result briefly and then resets.

On feed pages where scrolling changes the visible video without changing the
page URL, the download button finds the most visible/playing video and uses
the Redgifs watch link from that video's card.

Redgifs feed cards with the `GifPreview_isActive` class and
`data-feed-item-id` attribute are preferred because they identify the currently
active video directly.

The button is also available on Redgifs niche pages. It uses the active niche
card's `data-feed-item-id` instead of requiring the page URL to contain a
`/watch/<id>` path.

## Legal

This is an independent project and is not affiliated with, endorsed by, or
sponsored by Redgifs or Mozilla. The Redgifs and Firefox names and logos are
trademarks of their respective owners. Any third-party marks or logo artwork
included with the extension are not covered by a license for this project's
original code or documentation.

You are responsible for complying with applicable laws, platform terms, and
the rights associated with content you download. This extension does not grant
ownership of, or permission to use, downloaded content.

The Redgifs icon is a modified version of an asset sourced from
[CDNLogo](https://cdnlogo.com/licensing). CDNLogo states that its default
license is CC0, unless an individual icon page specifies otherwise. The
Redgifs brand remains a trademark of its respective owner; the icon's asset
license does not grant trademark rights or imply endorsement.

## Load temporarily

From an unpacked copy of the extension (a built `.zip` extracted, or
`build/Redgifs Video Downloader/` in the source repository after running
`pwsh -File ./build.ps1 -StageOnly`):

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on**.
3. Select that copy's `manifest.json`.
