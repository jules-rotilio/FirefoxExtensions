# Reddit Media Downloader

Firefox extension, companion to the Redgifs Video Downloader (both share the
same resolver and download code). It adds a **Fetch from Reddit & download**
button under each Reddit post and saves media in the folder
configured in the extension settings. By default, files go into `media_folder/`
inside Firefox's configured download directory.

Click the extension's toolbar button to open its settings popup, or open the
extension's settings from Firefox's Add-ons Manager. Choose any relative folder;
nested paths can use either `/` or `\`. Leave the setting empty to use Firefox's
download directory directly. Absolute paths are not supported because Firefox
controls the base download directory. The settings page also has a theme
choice (same as system, light or dark), which is remembered.

Firefox's data disclosure lists personally identifying information, browsing
activity, and website content. No post data is requested until you click that
post's button. The click sends the post ID and Reddit session cookies, if
present, to Reddit over HTTPS to retrieve media details. Media downloads run in
a temporary empty cookie store, so Reddit cookies are not sent to media hosts.
The `cookies` and `contextualIdentities` permissions are used only to create
these stores; the extension does not read cookie values.

The extension supports:

- Reddit images
- Reddit galleries
- Reddit-hosted videos
- Redgifs videos linked from Reddit posts

Reddit post data, media extraction, Redgifs resolution, and downloads are
handled by `background.js`. The content script observes Reddit's page and adds
a button under each post. When the button is clicked it sends only the post ID;
the background script fetches the post's JSON, finds the media and downloads
it. Media is only downloaded from `redd.it`, `redgifs.com` (including their
subdomains) and `i.imgur.com`; posts linking elsewhere report an error.

For Reddit-hosted videos, the extension checks Reddit's `has_audio` metadata.
When audio is present, it selects the highest video rendition and highest
available `HLS_AUDIO_N` track from Reddit's master playlist, then downloads
the matching `.ts` video resource alongside the AAC file. If audio metadata
is missing or false, it downloads Reddit's usual `fallback_url`.

All files from one click are downloaded through the same temporary cookie
store, which is removed once every file has finished. Stores left behind when
Firefox closes during a download are removed the next time the extension
starts.

## File names

Files are named after the subreddit and post ID, so every file from a post
starts with the same prefix:

| Media | Example |
| --- | --- |
| Image | `pics_1abc2d.jpg` |
| Gallery | `pics_1abc2d_01.jpg`, `pics_1abc2d_02.png`, … |
| Video without audio | `pics_1abc2d_DASH_720.mp4` |
| Video with audio | `pics_1abc2d_HLS_720.ts` and `pics_1abc2d_HLS_AUDIO_128.aac` |
| Redgifs video | `<watch-id>.mp4` |

### Combining video and audio

Reddit stores video and audio separately, so videos with sound arrive as two
files. [ffmpeg](https://ffmpeg.org/) can combine them into one `.mp4` without
re-encoding:

```sh
ffmpeg -i pics_1abc2d_HLS_720.ts -i pics_1abc2d_HLS_AUDIO_128.aac -map 0:v:0 -map 1:a:0 -c copy pics_1abc2d.mp4
```

## Redgifs videos

Redgifs links use the same resolver as the standalone Redgifs Video
Downloader. If every Redgifs source fails and Reddit has its own copy of the
video, that copy is downloaded instead, still named `<watch-id>.mp4`.
The resolver's source order:

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

The HLS playlist does not need to contain an `.mp4` URL. A playlist containing
an `.m4s` URI is a fragmented MP4 resource; the extension downloads the
underlying resource directly and names the result `<watch-id>.mp4`.

## Legal

This is an independent project and is not affiliated with, endorsed by, or
sponsored by Reddit, Inc., Redgifs, or Mozilla. The Reddit, Redgifs, and Firefox
names and logos are trademarks of their respective owners. Any third-party
marks or logo artwork included with the extension are not covered by a license
for this project's original code or documentation.

You are responsible for complying with applicable laws, platform terms, and
the rights associated with content you download. This extension does not grant
ownership of, or permission to use, downloaded content.

The extension icon is the generic Download icon from
[Lucide](https://lucide.dev/icons/download), not a Reddit logo. Lucide lists
this icon as derived from Feather and licensed under the MIT License. The icon
does not imply Reddit endorsement. The Reddit brand remains a trademark of its
respective owner.

```text
MIT License

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Load temporarily

From an unpacked copy of the extension (a built `.zip` extracted, or
`build/Reddit Media Downloader/` in the source repository after running
`pwsh -File ./build.ps1 -StageOnly`):

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on**.
3. Select that copy's `manifest.json`.
