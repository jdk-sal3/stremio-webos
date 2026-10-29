# Stremio webOS

Custom Stremio app for LG webOS TVs. Uses Stremio Theater v1.9.2 frontend (from [Vidaa project](https://github.com/NoobyGains/stremio-vidaa-tv)) with the official Stremio streaming server.

## Important: Build artifacts

Several files are **downloaded/generated at build time** and will not exist in a fresh clone:

- `service/server.js` — downloaded from `dl.strem.io` (Stremio streaming server, webOS build)
- `service/www/` — built from Vidaa frontend tarball + patches

Run `make build` to generate these before inspecting or modifying them.

## Structure

```
app/                  # webOS app shell — starts service, redirects to http://127.0.0.1:8080
  appinfo.json        # webOS app manifest (id: io.strem.tv)
  index.html          # Starts server via Luna, polls :8080, redirects when ready
  services.json       # Links to server service
  icon.png

service/              # webOS service
  launch.js           # Entry point: serves www/ on :8080, proxies API to streaming server on :11470
  index.html          # Theater entry point for webOS (sets __STREMIO_SERVER_URL__ to :8080)
  package.json        # Service manifest (main: launch.js)
  services.json       # Luna service registration
  server.js           # [downloaded] Official Stremio streaming server
  www/                # [built] Vidaa frontend + patches applied

patches/              # Patches applied to Vidaa frontend files during build
  video.chunk.js.patch
```

## How it works

1. `make build` downloads the Vidaa frontend (pinned to a specific commit) and Stremio server, copies frontend files into `service/www/`, applies patches
2. `make deploy` packages the IPK via `ares-package` and installs via `ares-install`
3. On launch: `app/index.html` starts the server service via Luna, polls `:8080` with an `<img>` load, redirects when ready
4. `service/launch.js` serves the Theater frontend on `:8080` and proxies all non-static requests to the streaming server on `:11470`

The proxy exists because the app loads from `file://` which cannot XHR/fetch to `http://` origins (CORS restriction on webOS Chrome 68). Serving everything from `:8080` makes all requests same-origin.

## Patches

Patches in `patches/` are applied to Vidaa frontend files during `make build`. They are unified diffs against the pinned Vidaa commit.

### video.chunk.js.patch

Adds an `addtrack` event handler to the WebOsVideo player's `<video>` element. This:

1. **Builds the audio track list from the native `audioTracks` API** — the native API returns tracks in Luna's internal order, so `selectTrack` indices match correctly (the original code used `getTracksData` from the streaming server which returns tracks in ffprobe order — a different order)
2. **Enriches track labels** from the streaming server's `/tracks/` endpoint when available
3. **Auto-selects the preferred audio language** from the user's Stremio profile settings (`profile.settings.audioLanguage`)

### sdh-subtitles-native-audio.patch

This patch adds `www/autolang.js` (ES5, `window.__autoLang`) and hooks it into `index.html`, `player.chunk.js` and `video.chunk.js`. Unit tests live in `tests/autolang.test.js`; run `node tests/autolang.test.js` after a build.

1. **Subtitles.** The player's track-selection effect calls `decideSubtitles(embedded, extra, profileLang, savedStreamState)`.
   - Ranking, highest first:
     1. English with an `SDH` word (`/(^|[^a-z0-9])sdh([^a-z0-9]|$)/i`, matched against label, raw addon label, name, title, id and URL file name)
     2. English
     3. English forced
     4. the profile subtitle language
   - On a tie, the first match wins; embedded tracks are checked before addon tracks.
   - The decision re-runs when addon tracks arrive and only switches to a strictly better rank.
   - Any manual pick in the menu stops it until the next video loads (`markManualSubs`).
   - Addon tracks keep their original label as `rawLabel`, because Stremio overwrites `label`.
2. **Audio.** `beginLoad(selected)` runs on each load. It takes the tt id from the meta or stream id and resolves the original language from the cache or from TMDB.
   - TMDB lookup: `/3/find/{tt}?external_source=imdb_id`, then `/3/tv/{show_id}` for episode-only hits.
   - Request path: direct HTTPS first, then the `/__tmdb/` proxy in `launch.js`. Timeout is 4s.
   - Cache: `localStorage["autolang.tmdb.v1"]`.
   - `pickAudioIndex(langs, prefs)` maps ISO 639-1 to 639-2 B/T. The preference order is TMDB, then `profile.settings.audioLanguage`, then the default track.
   - On WebOsVideo, a TMDB answer that arrives after the tracks loaded is applied by switching tracks through the normal `selectedAudioTrackId` path, unless the user already picked audio.
3. **Key.** `autolang.js` contains the placeholder `__TMDB_API_KEY__`. The Makefile replaces it after the patches are applied, using `$TMDB_API_KEY` or `.tmdb_key`, and fails if the key or the placeholder is missing.

## Deploy

Requires `@webosose/ares-cli` (install with `npm i -g @webosose/ares-cli`, needs Node 20 for SSH compatibility). The TV must be configured as device `tv` in ares (`ares-setup-device`).

```sh
make deploy    # build + package + install + launch
make build     # download dependencies + build service/www/ (needs TMDB_API_KEY or .tmdb_key)
make package   # build + create IPK
make restart   # close + relaunch on TV
make clean     # remove all build artifacts
```
