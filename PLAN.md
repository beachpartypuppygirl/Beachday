# Beachday — Development Plan

Audio player and playlist curation tool for local music files. Linux + Windows.

**Status:** Phases 1–4 complete; Phase 5 next.
**Last updated:** 2026-10-28

---

## 1. What Beachday Is

Beachday is two things stacked together:

1. **A competent local audio player** — mp3/flac/wav, sequence and shuffle playback, a big
   album-art display, a transport bar. This half is commodity; it has to be good, but it isn't
   where the value is.

2. **A portable playlist format** — this is the actual product. A `.bday` file carries its own
   metadata layer (track renames, custom art, per-track gain, link chains, subgroup definitions,
   a color palette) and can be handed to another person on another OS with all of that intact.

No other player does #2 well. foobar2000's `.fpl` is machine-local and opaque, M3U carries
nothing but paths. Design decisions should favour the playlist format when the two halves
conflict.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Shell | Electron (desktop app — own window, own `.exe`, no browser) |
| UI | React 19, **plain JavaScript, ESM modules** |
| Styling | CSS custom properties (required for per-playlist theming) |
| Audio | Web Audio API over an `<audio>` element source |
| Metadata | `music-metadata` (npm) — read-only |
| Virtualization | `@tanstack/react-virtual` |
| Archive I/O | `yazl` / `yauzl` or `archiver` for the `.bday` container |
| Packaging | `electron-builder`, cross-building Windows from Linux |
| Lyrics | LRCLIB (`lrclib.net`) |

### Why not C#/.NET + Avalonia

It was the obvious candidate and it's a reasonable stack, but every genuinely hard feature in
this concept is a web-stack strength: per-playlist theming is three CSS variables, animated GIFs
are free, large high-quality art scaling is free, and `GainNode` gives per-track dB in one line.

The strongest argument *for* .NET was TagLibSharp, the best tag **writer** available — but
Beachday deliberately never writes to track tags. All custom metadata lives playlist-side.
That removes the reason to care, and `music-metadata` reads tags perfectly well.

**Cost accepted:** ~200MB RAM idle, 2–3s cold start, ~120MB installer.

**What would justify revisiting:** wanting gapless playback, crossfade, or bit-perfect /
exclusive-mode output (WASAPI/ASIO). These are painful to retrofit in Electron. None are in
scope; if that changes, raise it before Phase 4.

**Ruled out:** Tauri — uses WebKitGTK on Linux and WebView2 on Windows, so the art pane and
audio behave differently on the dev machine than on the target machine. Wrong tradeoff for
"develop on Linux, ship to Windows."

---

## 3. Architecture

### Process model

- **Main process (Node)** — filesystem, `.bday` read/write, tag reading, art extraction and
  caching, native dialogs, window chrome, media keys.
- **Renderer (React)** — all UI, the audio graph, playback state.
- **IPC** — typed channel names, main process owns all disk access. The renderer never touches
  the filesystem directly.

### Audio graph

```
<audio> element  →  MediaElementAudioSourceNode
                 →  trackGain   (per-track dB override)
                 →  masterGain  (volume slider)
                 →  limiter     (DynamicsCompressor, clip protection)
                 →  destination
```

Using an `<audio>` element as the source **streams** the file rather than decoding it entirely
into memory. This matters: a 40MB FLAC decodes to roughly 250MB of PCM. `decodeAudioData` would
be the wrong call here.

**Two elements, not one.** Keep a pair of `<audio>` elements and preload the next track into the
idle one during the current track's final ~10 seconds, then swap on `ended`. See §5 for why.

Per-track gain conversion: `linear = Math.pow(10, dB / 20)`

Electron's prebuilt binaries ship Chromium with proprietary codecs enabled, so **mp3 and AAC
work out of the box**, and Chromium decodes **flac and wav** natively. All three required
formats are covered with no external decoder, plus ogg/opus/m4a as a bonus.

### Scope decision: playlist-only, no library

Beachday has **no scanned music library** in v1. There is no watched-folder index, no background
rescan, no persistent track database. Every playlist is self-contained and import is always an
explicit user action.

Rationale: a library is a whole subsystem (file watching, incremental rescan, a local DB) and it
isn't what this concept is about. If it's wanted later, it arrives as an additive feature — "a
playlist that auto-populates from a folder" — not a rewrite.

*Flagged as revisitable. Nothing in Phases 1–10 forecloses it.*

---

## 4. The `.bday` Playlist Format

**Always a ZIP container, in both modes.** Even reference-mode playlists need to store binary
assets (playlist cover, per-track custom images, subgroup covers, GIFs), and a plain JSON file
can't hold those without base64 bloat. One extension, one code path.

```
mymix.bday  (zip)
├── playlist.json        manifest
├── art/
│   ├── cover.png
│   ├── track-04.gif
│   └── group-02.jpg
└── audio/               populated only when bundled: true
    └── 04 - Cobalt Coastlands.flac
```

A `bundled: true|false` flag in the manifest says whether `audio/` is populated. "Convert to
bundled" and "strip to references" become simple operations on the same file.

**Audio entries are stored, not deflated** (as built in Phase 4). Compressed audio barely
shrinks, and a stored entry is a plain byte range inside the zip, so a bundled track streams
and seeks straight out of the `.bday` by offset with no extraction, however large the file.
The manifest is deflated. A bundled track's `relPath` is its entry name (`audio/<file name>`,
with ` (2)` on collisions); its fingerprint equals the loose file's.

### Manifest sketch

```jsonc
{
  "formatVersion": 1,
  "bundled": false,
  "meta": { "name": "", "description": "", "author": "", "cover": "art/cover.png" },
  "palette": { "primary": "#e8766b", "secondary": "#1a1a1a", "tertiary": "#f0c040" },
  "grouping": {
    "enabled": true,
    "groupKey": "%albumartist% / %album%",
    "mainName": "%album%",
    "subNames": ["%albumartist%", "%codec% %bitrate% | %tracks% Tracks | %duration%"]
  },
  "groups": [
    { "id": "g1", "art": "art/group-02.jpg", "description": "", "collapsed": false, "order": 0 }
  ],
  "tracks": [
    {
      "id": "t1",
      "relPath": "audio/04 - Cobalt Coastlands.flac",
      "absPath": "/home/me/Music/pla/04.flac",
      "size": 41203847,
      "fingerprint": "sha256:...",
      // Snapshot of the file's tags at import (Phase 4). Missing tracks still show titles and
      // durations, a recipient sees the playlist before relinking, and loading 5,000 tracks
      // doesn't re-read 5,000 files. artName is an art-cache entry, re-extracted from the
      // audio on machines that lack it.
      "tags": { "title": "...", "artist": "...", "album": "...", "duration": 175.0, "replayGainDb": -6.92, "artName": "9f06….jpg" },
      "overrides": { "title": "", "art": "art/track-04.gif", "gainDb": -2.5 },
      "groupId": null,          // explicit pin; overrides derived key
      "linkNext": "t2"          // chain link
    }
  ]
}
```

### Relinking (the hard part)

Cross-machine portability lives or dies here: Windows drive letters, backslashes, and
case-insensitive filesystems versus Linux's opposite on all three.

Per track, store **relative path, original absolute path, file size, and a cheap fingerprint**
(first 64KB + last 64KB + size, hashed). Resolve on load in this order:

1. Relative path, against the `.bday` location
2. Stored absolute path
3. Persistent folder-mapping table (`C:\Music` ↔ `/home/me/Music`)
4. Fingerprint match within known folders
5. Prompt the user

Step 3 is what makes this bearable — relinking one track teaches the mapping and fixes the
other 200 automatically. The mapping table is app-level config, not stored in the `.bday`.

---

## 5. Subsystem Designs

### Grouping — token templates, not hardcoded modes

Don't hardcode "by artist" and "by album." Grouping is a **token template**:

```
groupKey:  %albumartist% / %album%
mainName:  %album%
subNames:  [ %albumartist%, "%codec% %bitrate% | %tracks% Tracks | %duration%" ]
```

"By album" and "by artist" become presets of one mechanism, and "custom subgroups" stops being a
separate feature — it's a user-authored template. The reference screenshot's three-line header
(*Pokémon Legends: Arceus* / *Pokémon* / *Nintendo Switch | mp3-192 | 17 Tracks | 53:25*) falls
straight out of this.

**Art resolution chain**, so groups look right with zero user effort:
explicit group art → first track's custom art → first track's embedded art → playlist cover →
generated color block from the palette.

**Manual override membership.** Auto-grouping gets compilations, remix albums, and split
soundtracks wrong. A track may be pinned to a `groupId` explicitly, which wins over the derived
key. Collapse state and per-group manual sort order are curation decisions and travel inside the
`.bday`.

**Note on WAV:** WAV has essentially no metadata standard — no embedded art, no reliable tags.
Auto-grouping would fail for WAV files in any other player. Beachday's playlist-side metadata
layer fixes this for free. Worth leaning on.

### Shuffle — permutation with a cursor

Not reroll-on-each-advance. Build the queue once and walk it:

1. Build the list of **playable units**: chain heads and unlinked singletons.
2. Fisher–Yates shuffle into a permutation array `queue`.
3. A cursor `i` walks forward. Each unit expands to its full chain in order.
4. At the end: reshuffle, with the constraint that the new first unit ≠ the previous last.

This gets several things at once:

- **Shuffle-remaining** (every track plays once before any repeats) is the natural behaviour,
  not a special mode. No more hearing the same song three times in ten minutes.
- **Previous** walks the cursor backward, giving real shuffle history with no separate stack.
- Tracks added mid-session insert at a random position **after** the cursor, so they're still
  reachable this cycle.

Repeat modes (off / all / one) only change what happens when the cursor hits the end.

### Linked tracks — chains are atomic

A chain is a run of tracks joined by `linkNext`. Chains are **atomic units** in shuffle: the
shuffle operates on units, then each expands in order. A broken chain becomes structurally
impossible rather than a bug to hunt.

**Shuffle entry rule:** a chain has a **head**, and only the head enters the shuffle pool. A
track in the middle of a chain is never a shuffle entry point.

**Explicit selection rule:** if the user *clicks* a mid-chain track, playback starts there and
**continues through the rest of the chain**, then resumes the normal queue. Chain membership is
a property of the track, not of how playback arrived at it. In shuffle this means: click into
the middle of a chain → finish the chain → resume the shuffle cursor.

### Chain editing — contiguous by definition

Chains are **required to be contiguous in playlist order**. This is enforced, not advisory.

**Linking is a multi-select operation**, not a per-track pointer control. Select 2+ tracks →
**Link**. Select a linked track → **Unlink** breaks the chain at that boundary.

This constraint eliminates the entire category of invalid-state bugs by construction:

- There is no way to express "A → B where B already has a predecessor," because the user never
  sets pointers by hand.
- If a selection touches existing chains, they are absorbed into one chain.
- Non-contiguous selections are made contiguous at link time (tracks move together).
- **Linking always succeeds.** No rejection rules, no error dialogs, no merge/split prompts.

It also matches the real use case: songs that flow into each other are essentially always
neighbours (*Brain Damage* → *Eclipse*). Requiring contiguity costs nothing and removes a lot of
state-management surface.

`linkNext` remains the storage representation; the UI never exposes it directly.

### Theming — derive, don't slot

Three arbitrary user colors will produce unreadable combinations. Don't bind the raw values
directly to UI surfaces. Derive a token set:

```
--bg, --surface, --surface-raised, --text-primary, --text-muted,
--accent, --accent-hover, --border
```

Run a WCAG contrast check on each text/background pairing and auto-adjust lightness when one
fails. Otherwise someone picks three pastels and the app becomes illegible.

### Inter-track gap

True sample-accurate gapless is **out of scope** — it needs Web Audio buffer scheduling with
tracks decoded ahead into memory (~250MB per FLAC) and meaningful complexity. Ease of
construction wins here.

What is in scope is **not being careless about it**:

| Approach | Gap | Verdict |
|---|---|---|
| One `<audio>`, swap `src` on `ended` | 200–500ms | What you get by accident. Avoid. |
| **Dual `<audio>` + preload** | **~20–100ms** | **Baseline, Phase 2** |
| Web Audio buffer scheduling | ~0ms | Out of scope |

Dual-element preloading costs roughly half a day and moves the result from "noticeable dropout"
to "natural beat between tracks."

**MP3 caveat:** every MP3 carries encoder delay and padding baked into the file. Even perfect
scheduling leaves an audible seam unless the LAME/Xing header is parsed and those samples
trimmed. **FLAC and WAV are sample-exact and have no such padding.** Album transitions that need
to be seamless should be sourced as FLAC.

**Escape hatch (not building now):** buffer-scheduled true gapless *for chain transitions only*.
Chains are exactly where gaps matter and are a small fraction of tracks, so only one track is
ever decoded ahead and the memory cost stays bounded. Revisit in Phase 8 only if the seam proves
annoying in real use.

### Art pane

Target 1/2–2/3 of window width, user-resizable via a draggable split. Letterbox rather than
crop — cover art aspect ratios vary and cropping loses information. **No padding:** art is as
large as the pane allows, touching its edges on whichever axis it fills, and is never
stretched or cropped (decided 2026-10-28).

**Left-click anywhere in the art pane toggles play/pause**, as in foobar2000 (built in Phase 3).
Right-click is reserved for an art context menu (for example Set Custom Art, Phase 7).

**GIF guardrail:** Chromium caches decoded GIF frames, so a 1920×1080 / 200-frame GIF can exceed
1GB of decoded bitmap. At import, check `width × height × frameCount` against a threshold and
downscale once, storing the downscaled copy in `art/`. Typical album-art GIFs (500×500, ~30
frames) are a rounding error and need no intervention. Side benefit: keeps shareable `.bday`
files from quietly reaching 400MB.

Also pause animation when the window loses focus.

**Display modes** (View ▸ Art Pane; app-level preference): **Art Only** (default),
**Lyrics Only** (on a palette-derived background), **Lyrics Over Art** (white text, dark outline
plus soft shadow, optional dimming layer for busy art). Synced `.lrc` highlights the current line
and auto-scrolls; unsynced lyrics fall back to a static scrollable block. With no lyrics found,
Lyrics Over Art shows art alone and Lyrics Only shows "No lyrics found". Phase 10.

### Playlist tabs

Several playlists can be open at once as tabs. A tab is a **shortcut to a `.bday` file**, not a
loaded document. Decided 2026-10-28.

- **Placement:** a tab strip across the top of the **list pane**, above the playlist header
  (total tracks / total time). Not in the title bar: the title bar is the window's drag region
  and is already full with the menus. The art pane keeps its full height.
- **Session restore:** the open tab list (paths + display names, order, active tab) is app-level
  config in `userData`, **not** stored in any `.bday`. Restored on launch as *unloaded* tabs.
- **Lazy loading:** a tab loads its playlist when clicked. A slow first load is acceptable. An
  inactive tab may be unloaded again, except the one that is playing.
- **Missing files:** a tab whose `.bday` has moved shows as missing. Clicking it offers to locate
  the file or remove the tab.
- **Playing vs viewed:** playback belongs to one playlist and **keeps playing when you switch
  tabs**. The playing tab shows a ♪ marker, and View ▸ Jump to Now Playing switches back to it.
- **Theming follows the viewed tab.** The art pane keeps showing now-playing art regardless.
- **Unsaved changes:** closing a dirty tab, or quitting with one open, prompts "Save changes?".
  Never-saved "Untitled" playlists are not restored as tabs.
- **Undo history is per tab.** Cut/Copy/Paste is how tracks move between playlists.

**The cost lands in Phase 4, not 5.** The playlist store holds *many* playlists from the start
(`openPlaylists`, `viewedId`, `playingId`), even while the UI shows one. That's barely more work
up front. Converting a single-playlist store later would touch every call site. The tab strip
itself is a small UI job in Phase 5.

### Undo / redo

Every playlist mutation (reorder, add, remove, link/unlink, rename, art, gain, grouping,
properties) goes through **one undoable path**: a command applied to the store, with a per-playlist
history stack. Playback state is never in history. Like the multi-playlist store, this shape has
to exist from Phase 4, because retrofitting it means touching every edit site. Shortcuts and menu
placement are in `MENUS.md`.

---

**Menu bar:** where each feature is reached from lives in `MENUS.md`.

## 6. Phases

Phases 4 and 5 are deliberately early. They're the two that could force a rewrite, and they
should land while the codebase is small.

| # | Phase | Done when | Risk |
|---|---|---|---|
| 1 | **Foundations** — **DONE** | Electron shell runs on Linux; main↔renderer IPC working; `electron-builder` produces a Windows zip; custom window chrome | — |
| 2 | **Audio engine** — **DONE** | mp3/flac/wav play; seek, volume, play/pause/stop/next/prev; sequential order; transport bar; **dual-element preload** (§5) | Low |
| 3 | **Metadata + import** — **DONE** | Folder/file import reads tags and embedded art; art cached to disk; tracks render in a flat list | Low–Med |
| 4 | **Playlist format** — **DONE** | `.bday` saves and loads in both modes; **relink flow works across a simulated Linux→Windows path change**; multi-playlist store with per-playlist undo history (§5); **menu system** built from the `MENUS.md` table | **High** |
| 5 | **Track list** | Virtualized flat list → group headers → collapse → drag-reorder → multi-select, smooth at 5,000 tracks; playlist tab strip with session restore (§5) | **High** |
| 6 | **Art pane** | Large art with resizable split; GIF support with import guardrail; art resolution chain | Med |
| 7 | **Playlist-side metadata** | Per-track rename / custom art / dB; playlist name, description, author, cover; subgroup editor | Med |
| 8 | **Shuffle + links** | Permutation-cursor shuffle; shuffle-remaining; contiguous chains with multi-select Link/Unlink; mid-chain click behaviour; repeat modes | Med |
| 9 | **Theming** | Per-playlist palette picker; derived tokens; contrast validation | Med |
| 10 | **Lyrics + packaging** | LRCLIB fetch with toggle; art-pane lyrics modes; Windows zip + Linux AppImage; install docs for friends | Med |

---

## 7. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| **Cross-platform path relinking** | Breaks the core premise | 5-step resolution chain + persistent folder mapping. Phase 4, early. |
| **Grouped virtualized list** | Hardest component in the app | **Flattened row model** (`[{type:'group'},{type:'track'}]`) from day one. Virtualizing a nested tree is where this goes wrong. DnD + virtualization together are fiddly — budget time. |
| Large GIF memory | Bloated files, stutter | Import-time dimension/frame check + downscale |
| Per-track gain clipping | Audible distortion | Master-bus limiter; read ReplayGain tags as the default value |
| Theming readability | Unusable UI | Derived tokens + WCAG contrast auto-adjust |
| Lyrics source | Legal/ToS, IP bans | **LRCLIB only.** Genius's API deliberately omits lyrics; scraping Genius/AZLyrics violates ToS. LRCLIB is free, keyless, and returns synced `.lrc` timestamps. |
| `music-metadata` is ESM-only | Interop friction | **Project is ESM from the start.** No CommonJS. |
| Windows SmartScreen | Friends can't install | See below — solved, no cost |

### Distribution without a code-signing certificate

Scope is personal use plus friends. No commercial certificate needed.

**Primary approach — ship a ZIP, not an installer.** `electron-builder` outputs an unpacked
folder zipped rather than an NSIS installer. Recipient: right-click the zip → Properties →
**Unblock** → OK → *then* extract. Unblocking strips the Mark-of-the-Web before extraction, so
the extracted `Beachday.exe` launches with no SmartScreen prompt at all. One extra click, once.

**Fallback.** If they extract without unblocking, SmartScreen shows "Windows protected your PC."
It's **More info → Run anyway**. Routine for hobbyist software — warn friends in advance so it
doesn't alarm them.

**If real signing is ever wanted:** Azure Trusted Signing is ~$10/month with no hardware token
(eligibility bar applies). SignPath Foundation is free for OSI-licensed open-source projects.

**Do not bother with self-signed certificates** — Windows doesn't trust them either, so the
warning is unchanged and the setup is wasted effort.

*Minor:* Windows Defender occasionally false-positives on unsigned Electron apps. Rare; resolved
with an exclusion.

---

## 8. Deferred / Out of Scope

| Item | Decision |
|---|---|
| Equalizer (bass/treble) | Out. Gateway to audiophile-output territory that Electron serves poorly. |
| Scanned music library | Deferred. Additive later as an auto-populating playlist. |
| True sample-accurate gapless | Out — **decided**. Dual-element preload (~20–100ms) is the baseline instead. Chain-only gapless is a documented Phase 8 escape hatch. See §5. |
| Crossfade | Out. |
| Bit-perfect / exclusive-mode output | Out. Same. |
| Writing to track tags | **Never.** All custom metadata is playlist-side by design. |
| Shuffle-remaining | **In scope** — Phase 8. Falls out of the permutation-cursor model for free. |

---

## 9. Phase 1 — Complete (2026-10-26)

Verified working end to end:

- `npm run dev` — Vite dev server + Electron, hot reload
- `npm run pack:win` — 147MB `Beachday-0.1.0-win.zip`, valid `PE32+ GUI x86-64` binary,
  cross-built from Linux **without Wine** (a direct payoff of choosing zip over NSIS)
- `npm run pack:linux` — 120MB `Beachday-0.1.0.AppImage`, launches and initialises Chromium
- Custom frameless window chrome, working minimize / maximize / close
- IPC round trip both directions, including a native file dialog filtered to audio formats
- CSS token layer (section 5) in place, so Phases 2-8 already read from the right layer

Toolchain as verified: Electron 45.0.0, Chromium 156, Node 24.22, Vite 8.3.5, React 19.3.1,
electron-builder 26.18.0. `npm audit` clean.

### Gotchas worth remembering

- **Electron's postinstall can fail silently.** If `node_modules/electron/dist/` is missing,
  `electron .` does nothing and prints no error. Recover with
  `node node_modules/electron/install.js`. This bit us once when a disk-full condition killed
  the download mid-install.
- **Vite 8 binds IPv6-only (`[::1]`).** `wait-on tcp:127.0.0.1:5173` never resolves against it;
  the dev script uses `wait-on http://localhost:5173` instead.
- **A packaged Electron app swallows stdout/stderr.** `console.log` from the main process is
  invisible once packaged. To debug a packaged build, run its app directory through the dev
  Electron binary:
  `./node_modules/electron/dist/electron ./release/linux-unpacked/resources/app.asar`
  That surfaces the real error.
- **`ELECTRON_RUN_AS_NODE=1` makes the binary behave as plain Node** — no Chromium, and
  `require('electron')` returns a path string instead of the API, which produces confusing
  "does not provide an export named ..." errors. Never leave it set.

## 10. Next Steps

1. Phase 2 — audio engine: `<audio>` plus Web Audio graph, dual-element preload (section 5),
   working transport bar
2. Replace the Phase 1 smoke panel in `App.jsx` with real UI as Phase 3 lands
3. Replace the `build/icon.png` placeholder with real artwork whenever you feel like it

---

## 10. Phase 2 — Complete (2026-10-28)

Verified with a harness that runs the real protocol, preload and renderer against WAV (48kHz),
FLAC (48kHz/16) and MP3 (44.1kHz/128k, ID3v2.3), plus a deliberately corrupt file, in both dev
and built-bundle modes. Signal was confirmed with an analyser on the output bus, not just
element state.

- **Inter-track gap:** with the next track preloaded, the next deck's `playing` fires **~1ms**
  after `ended` (FLAC → MP3). Comfortably inside the ~20–100ms target.
- Seeking works in all three formats (Range requests → 206).
- Play/pause/stop/next/previous, mute, volume; Previous restarts after 3s; queue end stops.
- Unplayable tracks are skipped with a message in the transport bar.

### How it's built

- **`beachday-media://track/<token>`** (`src/main/media.mjs`). Main grants an opaque URL per
  user-chosen file and serves only those, with Range support. Tokens avoid encoding Windows
  paths into URLs and mean the renderer can't request arbitrary files. Phase 4's playlist
  loader grants URLs for each resolved track the same way.
- **Engine** (`src/renderer/audio/engine.js`): two decks, each `<audio>` → source → own
  `trackGain`, into `masterGain` → limiter → trim. The next track preloads in the final 10s.
  `nextIndex()` is the single seam Phase 8's shuffle cursor replaces.
- **Media keys** go through `navigator.mediaSession` in the renderer, which also feeds the
  Windows media overlay and Linux MPRIS. No main-process `globalShortcut` needed.
- Volume persists in `localStorage` (per-viewer convenience; app config moves to `userData`
  with session tabs in Phase 5).

### Findings worth keeping

- **Limiter makeup gain.** Chromium's `DynamicsCompressorNode` follows the spec's automatic
  makeup gain: at threshold −1dB / ratio 20 it lifts everything ~0.57dB (−6dB in → −5.43dB out)
  and can push near-peak audio past 0dBFS. A trim gain of −makeup restores exact unity below
  threshold. Measured: **+12dB of boost peaks at −0.09dBFS**, so **Phase 7 caps per-track gain
  at +12dB**.
- **Stale failure reports.** A broken file reports through both the `error` event and the
  `play()` rejection, and the second can arrive after the deck has moved to the next track.
  Each deck load bumps a `loadId`; async results compare against it.
- **MP3 encoder padding** (§5) is still present — the MP3 seam is real but small. Unchanged
  decision: FLAC for transitions that must be seamless.

---

## 11. Phase 3 — Complete (2026-10-28)

- **Import** three ways: Add files, Add folder (recursive; hidden entries and symlinked folders
  skipped) and drag-and-drop of files or folders onto the list. Paths are resolved and
  de-duplicated within one import. Tracks are ordered by folder → disc → track number → name.
- **Tags** via `music-metadata`, read-only, 2–9ms per file, 4 in flight. Unreadable tags keep
  the track under its file name. Format names are normalized (`WAV`, `MP3`, `FLAC`).
  music-metadata calls 24-bit extensible WAV "non-PCM (65534)".
- **Embedded art** cached to `userData/art-cache/<sha256>.<ext>`, content-addressed so an
  album's shared cover is stored once, and served as `beachday-media://art/<name>`.
- **Flat list** with a totals header (`N tracks | Time: m:ss`), playing-row marker, and
  double-click to play. The art pane shows the playing track's art, letterboxed. The transport
  shows album (in `--highlight`) then title, as in the reference skin.
- **Drops stay unforgeable:** the preload resolves paths from `File` objects with
  `webUtils.getPathForFile`, which page code can't fake, so main still reaches only files the
  user chose.
- Verified in a harness against the test tracks, including a CDP-simulated OS folder drop and
  screenshots via `capturePage()`. A packaged build (`electron-builder --linux dir`) contains
  only our source plus music-metadata's 13 packages, and launches cleanly.

### Carried forward

- **ReplayGain seeds per-track gain (decided 2026-10-28; Phase 7).** When a track is added to
  a playlist, `overrides.gainDb` starts at its ReplayGain track gain (`replayGainDb`), or 0dB
  if it has none. From then on it's an ordinary per-playlist value the user can adjust, saved
  in the `.bday`. Until Phase 7, `replayGainDb` is read and stored but not applied.
- **Art cache has no eviction.** It only grows. Cheap to add a sweep later (delete entries no
  open playlist references); not urgent at album-art sizes.
- **The menu system is built in Phase 4** (decided 2026-10-28), alongside the first real File
  items (New/Open/Save). The Add buttons in the list header move into File then.

---

## 12. Phase 4 — Complete (2026-10-28)

Done-when met: `.bday` saves and loads in both modes, and **a playlist saved on Windows
(`C:\Users\Me\Music\...`) relinks on Linux from an unrelated folder**. Locating one track
by hand taught `C:\Users\Me → ~`, which found a second by mapping and a renamed third by
fingerprint. A fourth, truly deleted track stayed missing and says so.

### What's built

- **Format** (`bday.mjs`): stored audio, deflated manifest, atomic writes (temp file + rename,
  retried on Windows lock errors), rejects non-zips and newer `formatVersion`s.
- **Relinking** (`relink.mjs`, `fingerprint.mjs`): the §4 chain, plus a case-insensitive retry
  for Windows-made paths on Linux. Paths from either OS are parsed by hand, not with the native
  `path` module. Only audio files are ever accepted, because a `.bday` is untrusted input.
- **Folder mappings** in `userData/config.json`, learned from manual relinks and editable
  under Options ▸ Folder Mappings. Recent files live there too.
- **Store** (`store/playlists.js`): many playlists with `viewedId` / `playingId`; one undoable
  `edit()` path with per-playlist history (200 steps); dirty = `doc !== savedDoc`.
- **Menu system** (`menus/commands.js`, `MenuBar.jsx`): one command table drives the menus,
  keyboard shortcuts and Help ▸ Keyboard Shortcuts. Electron's default menu is removed (it
  claimed Ctrl+W/Ctrl+Q); F12 toggles devtools in dev.
- **Unsaved changes**: closing the window, New, Open and Close Playlist all ask
  Save / Don't Save / Cancel (native dialog). Main holds the window open until the renderer
  confirms, unless the renderer has crashed or is still loading.

### Decisions made while building

- **Phase 4 shows one playlist at a time.** New and Open *replace* the viewed playlist, after
  asking about unsaved changes. A playlist that's playing when replaced keeps playing out of
  sight, and is released when playback moves to another playlist. Phase 5's tabs turn this into
  "open alongside".
- **Playback URLs never change across saves.** Bundling, extracting and re-saving a bundle all
  move audio. Main *repoints* the existing URL at the new location, so a playing track keeps
  playing and can still seek. Verified by converting reference → bundled → reference mid-song.
- **Save targets are main's choice.** The renderer sends the document and playback URLs; main
  maps URLs back to real sources and writes only to paths chosen in a dialog or Open Recent.
- **Unnamed playlists show their file name.** `meta.name` stays empty until set (Phase 7).
- **Bundling a playlist with missing tracks** bundles what it can, keeps the missing ones as
  references, and says how many it couldn't include.
- **Bundled → reference** asks for a folder and extracts into `<name> audio/` inside it.

### Known risks to check on Windows

- **Re-saving a bundle while one of its tracks plays** renames over a file with open read
  handles. libuv opens files with `FILE_SHARE_DELETE`, so this should work. Lock errors are
  retried. But it has only been verified on Linux.
- Drive letters, UNC paths and backslashes are covered by unit tests of the path parsing,
  not on a real Windows machine.

### Testing

`bday`/`relink`/`fingerprint` are Electron-free and unit-tested from plain Node. The app was
driven end to end through the **real** `main.mjs`, with native dialogs answered by a script:
import → undo/redo (menu label and Ctrl+Z/Ctrl+Y) → play → save → bundle mid-song + seek →
export copy → extract mid-song + seek → open the Windows playlist → relink → play a missing
track → quit with Cancel, then Don't Save. All 19 end-to-end checks and 6 unit-test groups passed. A packaged build contains
yazl/yauzl and launches.

