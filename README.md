# Stremio for webOS

Custom Stremio app for LG webOS TVs with working default audio language selection.

The official Stremio app has a bug where it always plays the first audio track in the list, ignoring the user's preferred audio language setting. This build fixes that by reading tracks from the TV's native media pipeline and automatically selecting the track matching your configured language.

Built from [Stremio Theater v1.9.2](https://github.com/NoobyGains/stremio-vidaa-tv) with the official Stremio streaming server.

## Prerequisites

1. Install the [webOS ares CLI](https://www.npmjs.com/package/@webosose/ares-cli) — `npm i -g @webosose/ares-cli` (requires Node.js 20 for SSH compatibility)
2. Either enable [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) on your TV, or have [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) installed
3. Configure your TV as a device — `ares-setup-device`

> **Note:** Developer Mode expires after 1000 hours and any sideloaded apps will be uninstalled. Rooted TVs with Homebrew Channel do not have this limitation.

## Automatic subtitles and audio

- **Subtitles** are always turned on, in English. A track whose label, name or file name contains the word `SDH` (for example `SDH`, `[SDH]`, `.sdh.`) is preferred. `CC` alone does not count as SDH. If there is no English SDH track, the first plain (non-forced) English track is used. This works for embedded tracks and for addon subtitles, including addon subtitles that arrive late. Once you pick a subtitle in the player menu, your choice is kept.
- **Audio** follows the title's original language, taken from TMDB's `original_language` and looked up by IMDb id. The result is cached in `localStorage`. If TMDB has no answer, or is slow or unreachable, the player falls back to your Stremio audio-language setting and then to the stream's default track. Playback never waits on TMDB.

### TMDB API key

The TMDB key is **injected at build time**. It is never stored in git. Provide it in one of two ways:

```sh
TMDB_API_KEY=your_key make package    # environment variable
echo your_key > .tmdb_key             # or a gitignored file in the repo root
```

`make build` fails with a clear error if no key is found. The key ends up inside the built IPK (`www/autolang.js`), so do not publish IPKs built with a private key. If the TV cannot reach TMDB directly, requests go through the local service proxy at `/__tmdb/`.

## Install via Homebrew Channel

If your TV is rooted with [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel):

1. Open Homebrew Channel on your TV
2. Go to settings and add this repository: `https://raw.githubusercontent.com/kieranbrown/stremio-webos/main/webosbrew/apps.json`
3. Find Stremio in the app list and install

## Install manually

```sh
make deploy
```

This downloads all dependencies, builds the app, packages the IPK, installs it on your TV, and launches it.

Replace the default device name if needed: `make deploy DEVICE=myTV`

### Other commands

```sh
make build     # Download dependencies + build (no install; needs TMDB_API_KEY)
make package   # Build + create IPK
make restart   # Close + relaunch on TV
make clean     # Remove build artifacts
```

## Auto-start on input select

On rooted TVs, you can register Stremio as an input source so it appears in the TV's input list and can auto-launch:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"io.strem.tv","pigImage":""}'
```

Run this via SSH on the TV.

## Credits

- [Stremio](https://www.stremio.com/)
- [NoobyGains/stremio-vidaa-tv](https://github.com/NoobyGains/stremio-vidaa-tv) — Theater frontend
- [webOS Homebrew Project](https://www.webosbrew.org/)
