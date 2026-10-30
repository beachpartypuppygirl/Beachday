# Beachday — Development Plan

Audio player and playlist curation tool for local music files. Linux + Windows.

**Status:** Phases 1–9 complete; Phase 10 next.
**Last updated:** 2026-10-30

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
  "palette": { "primary": "#14110f", "secondary": "#e8766b", "tertiary": "#f0c040" },  // null: the default
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
the first track's generated symbol (§14).

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

**Roles (decided 2026-10-30):** primary is the background family, secondary the accent, tertiary
the highlight. Light themes are allowed and follow the colour. Built in Phase 9; see §17.

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
| 5 | **Track list** — **DONE** | Virtualized flat list → group headers → collapse → drag-reorder → multi-select, smooth at 5,000 tracks; playlist tab strip with session restore (§5) | **High** |
| 6 | **Art pane** — **DONE** | Large art with resizable split; GIF support with import guardrail; art resolution chain | Med |
| 7 | **Playlist-side metadata** — **DONE** | Per-track rename / dB (custom art landed in Phase 6); playlist name, description, author, cover; subgroup editor | Med |
| 8 | **Shuffle + links** — **DONE** | Permutation-cursor shuffle; shuffle-remaining; contiguous chains with multi-select Link/Unlink; mid-chain click behaviour; repeat modes | Med |
| 9 | **Theming** — **DONE** | Per-playlist palette picker; derived tokens; contrast validation | Med |
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

---

## 13. Phase 5 — Complete (2026-10-28)

Done-when met: virtualized list → group headers → collapse → drag-reorder → multi-select,
**smooth at 5,000 tracks**, plus the tab strip with session restore.

Measured with 5,000 tracks in 600 groups: open 30ms, turn grouping on 41ms, scroll median
8ms per 1,500px jump (worst 34ms), 58 rows in the DOM. Grouped layout alone: ~7ms.

### What's built

- **Grouping** (`store/grouping.js`): token templates, with By Album and By Artist as presets.
  Headers follow the reference skin: thumbnail, main name in `--highlight`, sub-name, a detail
  line (`Nintendo Switch | mp3 128 kbps | 1 Track | Time: 2:00`, empty segments dropped), and
  the year. A group with no art gets its first track's generated symbol (Phase 6), the last
  step of the §5 art chain.
- **Flattened row model** with fixed row heights (track 22px, group 74px). The virtualizer
  (`@tanstack/react-virtual`) renders on-screen rows only. Pointer y maps to a row by binary
  search over cumulative offsets.
- **Selection**: click, Ctrl+click, Shift+click, arrows / Home / End / PageUp / PageDown
  (Shift extends), Enter plays, Ctrl+A. Clicking a group header selects its tracks.
- **Drag to reorder** is hand-rolled on pointer events (HTML5 drag-and-drop fights
  virtualization), with a drop line, a drag label, and auto-scroll at the edges. Group headers
  drag whole groups.
- **Edit**: Cut / Copy / Paste (an in-app clipboard; how tracks move between playlists), Remove
  (Delete). All undoable.
- **Tabs** (`TabStrip.jsx`) atop the list pane, per §5: ♪ on the playing tab, • when unsaved,
  × or middle-click to close, + or double-click empty strip for new, Ctrl+Tab /
  Ctrl+Shift+Tab, scroll position remembered per tab. New and Open now open *alongside*;
  an untouched empty tab is reused.
- **Session restore**: saved tabs persist to `config.json`. On launch they come back unloaded,
  and the active one loads immediately. A tab whose file has gone says so and offers Locate… /
  Close Tab. Options ▸ Restore Tabs on Startup turns it off.
- **Track menu + right-click**: Show in File Manager (a bundled track shows its .bday) and
  Properties (read-only tags, format, ReplayGain, location; totals for several tracks). The
  right-click menu adds Cut / Copy / Paste / Remove.
- **View**: Collapse All / Expand All Groups, Jump to Now Playing (Ctrl+J: switches tab,
  expands the group, selects and centres the row).

### Decisions made while building

- **Playback follows the grouped display order**, so what you see is what plays. Groups appear
  in the order of their first track in the playlist; within a group, playlist order holds.
- **In a grouped view, tracks drag only within their own group.** Their tags decide the group,
  so a track dropped elsewhere would jump straight back. Pinning a track to another group is
  Track ▸ Move to Group (Phase 7). Mixed-group selections can't be dragged; the drag label
  greys out.
- **Collapse state is view state.** It isn't undoable and doesn't mark the playlist unsaved,
  but it's written into the .bday's `groups` on save (§5: it travels).
- **Removing the playing track doesn't stop it.** It plays on "detached", and Next continues
  from where it was. This covers Delete, Cut and undoing its add.
- **Imports don't select what they add; Paste does**, so pasted tracks can be moved straight away.
- **Loaded tabs stay loaded.** §5 allows unloading inactive tabs, but at these memory sizes it
  isn't worth the complexity yet.
- Not built: dragging tabs to reorder them. Small, if wanted.

### Testing

33 end-to-end checks through the real `main.mjs`, using real mouse and keyboard input via
`sendInputEvent` (clicks with modifiers, drags, shortcuts), plus a second launch to verify
session restore and a missing-file tab. The Phase 4 suite (19) was re-run green against the
new tab behaviour. Pure modules (`grouping.js`, `bday`, `relink`) have plain-Node tests.
All of it now lives in the repo under `tests/` (`npm test`), built on throwaway copies of the
git-ignored test tracks.


---

## 14. Phase 6 — Complete (2026-10-30)

Done-when met: large art with a resizable split, GIF support with the import guardrail, and the
full art resolution chain. Pulled forward from Phase 7 at the user's request: **Track ▸ Set
Custom Art… / Clear Custom Art**, so GIFs and the chain can be tried in the app.

### What's built

- **Split** (`App.jsx` `Splitter`): drag the divider, arrow keys when focused, double-click to
  reset. Stored as a fraction of the window width, so it scales with the window. Floors: art
  pane ≥ 240px, list ≥ 420px, enforced by CSS `clamp()` as the window resizes and by the drag.
  View ▸ Show Art Pane hides it; View ▸ Reset Art Pane Size returns to 55%. Both are app-level,
  in `config.json` (`artPane`), not in any playlist.
- **Playlist art in the `.bday`** (`bday.mjs`, `playlists.mjs`). Before Phase 6, saving dropped
  any `art/` entries. Now: documents refer to playlist art as `art/<cache name>`. On open, every
  `art/` entry is unpacked into the art cache and references are rewritten to it. On save, the
  referenced images are written back into `art/` (stored, not deflated). A reference to an
  image that isn't there (or isn't a valid name) is dropped, so the chain falls through.
  Verified by reopening a saved playlist with the art cache deleted.
- **Art chain** (`store/art.js`, pure):
  - track: custom art → embedded art
  - group header: explicit group art → first track that has art (custom, then embedded) →
    playlist cover → its first track's generated symbol
  - art pane: the playing track's art → its group's art (grouped view) → playlist cover →
    the track's generated symbol
- **GIF guardrail** (`gif.mjs`, pure JS: `omggif` decodes, `gifenc` encodes; nothing native, so
  the Windows cross-build is unaffected). Budget **256MB decoded** (w × h × 4 × frames). Over
  budget, the GIF is re-encoded once at a smaller size, aspect kept, delays, looping and
  transparency intact. The longest edge never drops below 360px; past that, frames are dropped
  with their delays merged so the animation runs the same length. Over 50M pixels or 10,000
  frames is refused outright. Runs in main, yielding between frames, because main also serves
  the audio stream. Measured: 1200×1000×60 takes ~2.5s, so a 1920×1080×200 monster takes
  roughly 15s, once, behind a "Preparing art" busy indicator.
- **Every image entering the cache is checked**: type from magic bytes (never the declared
  format or extension), 64MB cap, GIFs through the guardrail. Embedded art, picked files and
  `.bday` entries all take this path. A `.bday` is untrusted input.
- **GIFs are played by Beachday, not by `<img>`** (`ArtImage.jsx`): frame by frame onto a
  canvas with Chromium's `ImageDecoder` (WebCodecs), honouring each frame's delay and the GIF's
  loop count. That's what makes pausing real: a paused GIF holds its frame and resumes from it.
  Only the frame on screen is decoded, so Chromium's keep-every-frame memory cost (the reason
  for the guardrail) no longer applies in the app. The guardrail still matters for `.bday`
  size and for anything else that opens the image.
- **GIFs pause** when the window loses focus (Options ▸ Pause GIFs When Window Is Unfocused,
  all GIFs), and the art pane's GIF pauses **with the music** (Options ▸ Pause GIFs When
  Playback Pauses: paused or stopped). Both are on by default and live in `config.json`. Added
  after the user's review: a GIF that kept dancing through a paused song felt wrong. Group
  thumbnails don't follow playback; they aren't the song.
- **Art pane right-click menu** (after review): Set Custom Art… / Clear Custom Art for the
  **playing** track (whatever is selected), Jump to Now Playing, Reset Art Pane Size, Show Art
  Pane, and Pause GIFs When Playback Pauses. Right-click never toggles playback. The menu
  component is shared with the track list (`ContextMenu.jsx`).

### Decisions made while building

- **Custom art applies to every selected track.** Select an album's tracks → one Set Custom
  Art… gives them all the same image. One undo step.
- **Cache names hash the bytes as they came in**, not the downscaled result. So a re-imported
  oversized GIF isn't re-processed, and `tags.artName` stays valid across machines. A
  downscaled GIF unpacked from someone's `.bday` gets a new name on the recipient's machine.
  That's harmless: the reference is rewritten on open.
- **Saving keeps group entries' other fields.** It used to rebuild `groups` from collapse state
  alone, which would have erased group art and descriptions (Phase 7).
- **Generated art is per track, not per group**: a group header shows its first track's symbol.
- **"Art Only / Lyrics…" stays hidden** until Phase 10: a one-option radio group says nothing.
- **Not built:** an art-cache sweep (the cache still only grows; PLAN.md §11).

### Testing

`tests/unit/gif.test.mjs` (planning, resize, re-encode with transparency, frame merging,
refusal) and art-chain checks in `grouping.test.mjs`. `core.test.mjs` round-trips `art/`
entries through a `.bday`. `tests/e2e/phase6.steps.mjs` (36 checks) drags the real divider,
sets an over-budget GIF as custom art through the native dialog, checks the GIF holds its
frame through blur and through a music pause and resumes from that frame, uses the art pane's
right-click menu with a real right-click, saves, deletes the art cache and reopens (art unpacked from the file), then opens
a hand-made `.bday` whose cover is an over-budget GIF and whose other references are bogus.
`E2E_ONLY=6 npm run test:e2e` runs just that suite. A packaged Linux build contains
`omggif`/`gifenc` and launches.

### Generated default art (after review)

The end of the art chain used to be a lettered square from the palette. It's now a **symbol
drawn for the track** (`src/renderer/symbols.js`): a flowing, brush-stroke shape in one colour
family on a transparent background, kept 13% clear of every edge. Designed with the user over
four sample sheets; references were the Mega Evolution symbol (flowing, standalone) and a free
"flow" illustration, with crests dropped for looking insectoid.

- **Drawn, not shipped.** Eight recipes (splash, flow, curl, tail, ribbon, twin, wave,
  planet), each a few rules for laying down strokes: a "walking pen" that turns by a sum of
  sine waves, thickened by a brush profile, plus each recipe's extras (flicks, droplets,
  strands, twists, foam, orbits, cut-outs). A seeded RNG (FNV-1a → mulberry32) picks every
  curve, width and colour, so every track gets its own symbol, not one of a fixed set. ~0.5ms
  each, a few KB of code, nothing stored. Kept as data: URLs, most recent 300.
- **Seeded by the audio fingerprint** (`art.js symbolSeed`): the same track gets the same
  symbol on any machine, through renames and moves, and in a friend's copy of the playlist.
  Retagging changes the fingerprint (§4), so it changes the symbol. Not fingerprinted: the
  file name, then the track id.
- **Colour**: one of 15 saturated hues (deep, vivid or bright) or white, as four shades, used
  as gradients across the shape or along each stroke (dark root, pale tip).
- **Wave never closes on itself**: the swoop is relaxed until its lip clears the rest of the
  stroke (`touchesItself`).
- **Shown in** the art pane, group header thumbnails (on a `--surface-raised` tile), and the OS
  media overlay (a 512px PNG on `--bg`, since overlays take no SVG and show transparency badly).
- **The recipes are now fixed.** Anything that changes how much randomness a recipe consumes
  changes every track's symbol. Add new recipes at the end of the pool if ever needed, and
  expect existing symbols to shift then too.
- Tested: `tests/unit/symbols.test.mjs` (determinism, 400 seeds all inside the padding, no
  NaN, every recipe appears, seed fallbacks), and the e2e suite checks the pane's symbol is the
  fingerprint's, the overlay gets a 512px PNG, and an artless group header shows its symbol.

---

## 15. Phase 7 — Complete (2026-10-30)

Done-when met: per-track rename and dB, playlist name / description / author / cover, and the
subgroup editor, all playlist-side, all undoable, all carried in the `.bday` and verified by
reopening with an empty art cache.

### What's built

- **Rename in place** (Track ▸ Rename…, F2). The row's title becomes a field, text selected.
  Enter or clicking away keeps it, Escape drops it, clearing it (or typing the tag title) removes
  the override. The new name shows in the list, the transport, `%title%` in group templates and
  the OS media overlay (refreshed live, as custom art already was).
- **Per-track gain** (`store/gain.js`, pure). Track ▸ Adjust Gain… is a slider (−30 to +12dB)
  plus an exact field. It previews on the playing track while you type, Cancel puts it back,
  and Apply changes the playing deck at once (ramped, no click). For several tracks it sets
  them all, and says when they differed. Over +12dB it's capped and says why. Reset Gain
  goes back to the ReplayGain value. The engine also updates a preloaded deck's gain.
- **Playlist ▸ Properties…**: name (placeholder: what it's called now), author, description,
  cover (Choose… / Remove, previewed before Apply). The header shows the name **by author**
  with a small cover, and the description under the name: three lines, then **more / less**
  (a very long one scrolls when expanded). Double-click the header to open Properties. The
  tab and the session list use the name.
- **Playlist ▸ Grouping ▸ Custom…**: edits the template (Group by, header, second and third
  line), with clickable `%tokens%`, By Album / By Artist starting points, and a live preview of
  the first three headers and the group count. A template identical to a preset becomes that
  preset.
- **Edit Groups…** (Playlist menu, or a header's right-click ▸ Edit Group…): the groups on the
  left (name, second line, track count, "custom"), the chosen one's fields on the right with a
  live header preview. Header lines are templates that override the grouping's line by line;
  empty lines show the grouping's value in grey. Description (shown under the header's
  lines, up to three, the rest on hover), group art (Choose… / Clear; without it, art comes from its tracks as before). Everything applies
  as one undo step.
- **Custom groups and Move to Group**: Track ▸ Move to Group ▸ lists every group (first 40),
  New Group…, and By Tags (Automatic). New Group… makes a custom group of the selection and
  opens the editor on its name. It works with grouping off too: it then turns on **Grouping ▸
  Custom Groups Only** (a preset whose tags group nothing, so every track outside a custom
  group sits under "Ungrouped Tracks") rather than regrouping the playlist by album.
  **Dragging tracks onto a custom group moves them into it**, where they're dropped, in one
  undo step; tag groups still refuse tracks from elsewhere. Custom groups survive template changes. A custom group can be
  dissolved (its tracks return to their tag groups). One that nothing is pinned to any more
  isn't saved.
- **Group header right-click menu**: Edit Group…, Set Group Art… / Clear Group Art,
  Collapse/Expand All, then gain, Move to Group and the clipboard for its tracks.
- **Track ▸ Reset All Overrides**: name, art, gain and group pin back to the file's own.
- **Track Properties** gained an "In this playlist" section: name, gain and where it came
  from, custom art, the group a track was moved to.

### Decisions made while building

- **ReplayGain is the default, not a value written at import.** `overrides.gainDb` absent
  means "the track's ReplayGain, or 0dB", so playlists made before Phase 7 get the seed too,
  and Reset Gain just removes the override. Same result as §11's "starts at", one fewer state.
  The tags snapshot travels in the `.bday`, so a recipient gets the same seed. Two of the three
  test tracks turned out to carry ReplayGain (MP3 −4.32dB, FLAC −6.92dB).
- **Pins are group keys.** `track.groupId` holds a group key: a custom group's
  (`custom:g_…`), or a tag-derived one. A pin is honoured while its group exists. A pin to a
  tag group the current template no longer produces falls back to the track's own group,
  rather than making a stray one-track group. Pinning a track to the group its tags already
  give it stores no pin. A group's header fields come from a track that belongs by its tags,
  not one pinned in.
- **Group entries override, never replace.** `doc.groups[]` entries keep `key`, and may carry
  `mainName`, `subNames`, `description`, `art`, `collapsed`, and `custom: true`. A `.bday`
  is untrusted, so non-string values are ignored.
- **Two sub-lines at most** in the editors (`SUB_LINES`): the 74px header row fits three
  lines in all.
- **Descriptions are shown, not hovered** (after review: whether to show one is the
  curator's call, by writing one or not). A group header with a description is the one row
  whose height isn't fixed: it's measured by the virtualizer (`measureElement`) and keyed
  `gd:<key>`, so adding or removing a description never reuses a stale size. Row offsets now
  come from `virtualizer.getMeasurements()`, and the old `virtualizer.measure()` after every
  layout change is gone (it would wipe measured sizes; a change of row keys already makes the
  virtualizer recompute). Group descriptions clamp at three lines in the list.
- **Drops into custom groups only** (after review). In a tag group a dropped track would
  jump straight back, so tag groups still accept only their own tracks.
- **Menus grow to fit their labels**, up to 340px, past which a label wraps onto a second
  line. Never cut off (an ellipsis rule added for long Move to Group names had been cutting
  off View ▸ Jump to Now Playing and the Pause GIFs options).

### Testing

`tests/unit/gain.test.mjs` (seed, override, caps, formatting) and pins / custom groups /
header overrides / dissolve / malformed entries in `grouping.test.mjs`.
`tests/e2e/phase7.steps.mjs` (53 checks): F2 → type → Enter with real keys, Escape, clearing;
gain preview / cancel / cap / apply / reset against the playing deck's applied gain; Playlist
Properties with a cover; a custom template typed with a token clicked in; a real right-click ▸
Move to Group ▸ New Group…; the group editor; a header's right-click menu; save, delete the
art cache, reopen and play; dissolve; Reset All Overrides; pruning of an empty custom group;
menus showing every label in full; the description's more / less; a described header growing
with rows below making room; a real drag into a custom group; New Group… with grouping off.

**Flaky, not new:** Phase 5's 5,000-track scroll check (worst step < 50ms) fails about half
the time today on the committed Phase 6 code too, with medians ~35ms against 8ms when it was
written. Profiling shows the same costs before and after Phase 7 (mostly React dev-mode
element creation). The machine is busier; the threshold may want loosening, or measuring
against the production build.

---

## 16. Phase 8 — Complete (2026-10-30)

Done-when met: permutation-cursor shuffle with shuffle-remaining, contiguous chains with
multi-select Link / Unlink, the mid-chain click rule, and repeat modes. All per §5.

### What's built

- **Play order** (`audio/sequence.js`, pure). The queue splits into **units**: a chain, or a
  single track. Shuffle permutes units and plays each in order, so a chain is never broken
  and only its head is a shuffle entry point. The shuffle is a list of track ids plus a
  cursor: Previous walks back through what actually played, every track plays once per cycle,
  and a new cycle (Repeat All) never opens with the unit that just closed the last.
- **Queue edits keep the shuffle** (`reconcileShuffle`): units keep their order, removed
  tracks drop out (the cursor sits "between two" if the playing track goes), and added or
  newly linked units land at random places that are still to come this cycle.
- **Picking a track while shuffling** moves its unit up to play now (`bringForward`), so it
  isn't heard again later in the cycle. Picking mid-chain starts there and plays out the
  chain, then the shuffle carries on: §5's rule, in both orders.
- **Engine** (`engine.js`): `order` ('sequential' | 'shuffle'), `repeat` ('off' | 'all' |
  'one'), `stopAfterCurrent`. Repeat One replays the track when it ends; Next and Previous
  always move. Repeat All wraps (sequential) or reshuffles. Turning shuffle on, or
  Reshuffle, puts the playing unit first. Play with nothing loaded starts at the top, or at
  the start of a fresh shuffle. Order and repeat persist like volume (`localStorage`).
- **Stop After Current**: stops when the track ends, with the next track cued (loaded, not
  playing) so Play carries on from there, then switches itself off.
- **Transport**: shuffle and repeat toggles either side of the round buttons, lit when on.
  Repeat cycles Off → All → One, marked with a small "1".
- **Playback menu**: Order ▸ Sequential / Shuffle, Repeat ▸ Off / All / One, Reshuffle,
  Stop After Current.
- **Link Selected** (Ctrl+L): the selection and any chains it touches become one chain in
  display order. Tracks that weren't neighbours move up to follow the first. In a grouped
  view, tracks from other groups join the first one's group (pinned). Always succeeds.
- **Unlink** (Ctrl+Shift+L): the selected tracks leave their chains (links into and out of
  each are cut). Select a whole chain to dissolve it.
- **Chains stay contiguous through every edit**: dragging any chain member drags the whole
  chain; a drop that would land inside a chain lands before or after it instead; removing
  (or cutting) a chain's middle track closes the chain up; Move to Group and New Group
  take whole chains; a copied chain pastes as a chain (new ids, links remapped).
- **Drawn** as a rail down the left edge of the rows, with a node per track.

### Decisions made while building

- **A link counts only when contiguous in display order** (`grouping.js linkedIds`, and
  `sequence.js unitsOf` reads the queue the same way). Edits keep chains contiguous, so this
  only matters when something regroups the playlist (a template change, pinning part of a
  chain elsewhere): the split link goes quiet rather than half-working, and comes back if the
  tracks are neighbours again. It stays in the file.
- **Shuffle state lives in the engine**, not the playlist: it's playback, not curation.
- **Order and repeat are app-level** (like volume), not per playlist.
- **Stop After Current was pulled in** (it was ✦, unphased): it's playback-order logic and
  fell out of the same code.
- **Options ▸ Show Track Shapes Instead of Art** (added after review): the art pane, group
  header thumbnails and the OS overlay show every track's generated symbol, art or not, so
  the shapes can be seen on tracks that have art. App-level, in `config.json` (`showShapes`),
  also in the art pane's right-click menu. The playlist cover in the header is the
  playlist's own picture, not a track's, so it stays. Nothing is removed: switching it off
  brings every piece of art back.
- Not built: §5's chain-only true gapless (the escape hatch). Chain transitions use the
  normal dual-deck preload (~1ms measured in Phase 2). Revisit if a seam bothers you.

### Testing

`tests/unit/sequence.test.mjs`: units (and stale links not counting), 200 seeded shuffles
(every track once, chains whole and in order, only heads lead, first / notFirst), reconcile
(order and cursor kept, additions ahead, removal, new chains), bringForward, and chains in the
layout (rails, withChains, a link split by grouping going quiet).
`tests/e2e/phase8.steps.mjs` (30 checks): real Ctrl+L / Ctrl+Shift+L, healing, paste, real
drags (into a chain's middle; a chain's tail dragging the chain), playing tracks to their real
end for chains, shuffle pick-and-continue, Previous, Repeat One / All / Off, Stop After
Current; real clicks on the transport toggles; grouped linking across groups; links through
save and reopen. `phase6.steps.mjs` gained the Show Track Shapes checks (pane, headers, a
512px symbol in the overlay, config, back off).

Phase 5's 5,000-track scroll check was loosened at the user's request to median < 50ms and
worst step < 100ms (was worst < 50ms): today's host runs it at 23–36ms median with worst steps
to ~70ms, with no code regression behind it.

Test audio moved out of the project to `~/Desktop/audiotracks` (21 tracks; the tests use
three of them). `tests/fixtures.mjs` reads from there, or `$BEACHDAY_TEST_AUDIO`.

---

## 17. Phase 9 — Complete (2026-10-30)

Done-when met: a per-playlist palette picker, derived tokens, and contrast validation, undoable
and carried in the `.bday`.

### What's built

- **Roles** (the user's call): **primary = background family**, **secondary = accent**,
  **tertiary = highlight**. This differs from the old §4 sketch and from Phases 1–8's
  stand-ins, which had the accent as "primary". No saved playlist has a palette yet, so
  nothing needs migrating.
- **Derivation** (`store/theme.js`, pure): palette in, tokens out. A pale primary makes a light
  theme by luminance alone; there's no mode to set. Surfaces step from `--bg` towards the text.
  `tokens.css` is the default palette's derivation written out, so there's one source of truth
  (a unit test keeps them equal). The default look moved by a couple of RGB values at most.
- **Contrast**: `PAIRINGS` lists every promise (22 pairings: 4.5:1 for text, 3:1 for quiet
  text and borders). Only lightness moves, so a colour keeps its hue. The background keeps the
  exact colour picked unless its text can't read across all its surfaces (a mid-tone colour
  moves; `INK_ROOM` leaves secondary and muted text room to stay quieter than primary text).
- **Playlist ▸ Colors…**: a native picker and a hex field per colour, eight presets (three
  light), Suggest from Art, and a note on any colour that was shifted ("Shown as #…, to stay
  readable"). The whole app is the live preview, so the dialog sits left of the list with a
  much lighter backdrop. Cancel lets the preview go; Apply is one undo step, Change Colors.
- **Suggest from Art**: reads the cover, else the playing track's art, else the first art in
  the playlist (a GIF's first frame), sampled at 64×64. Each click gives the next of three
  readings: deep, light, bold. Picking colours is `suggestPalettes` (pure); the decoding is in
  `actions.js`.
- **Theme follows the viewed tab** (`ThemeSync` in `App.jsx`), and sets `color-scheme` so
  scrollbars and native controls match.

### Decisions made while building

- **Selected rows are tokens** (`--selected`, `--selected-soft`), replacing `color-mix()` in
  CSS: a tint the stylesheet mixes can't be contrast-checked. The tint weakens when text
  wouldn't read on it.
- **`--accent-contrast` is the background itself where that reads**, and also sits on
  highlight fills, which is why it's checked against accent, accent hover and highlight.
- **The default palette is stored as `null`**, so choosing the Beachday preset returns a
  playlist to no palette at all. There's no separate Reset button.
- **Dark themes get `--bg` as their deepest layer, light themes as their palest.**
- **A malformed palette in a `.bday` is dropped whole** (`validPalette` in `playlists.mjs`):
  three `#rrggbb` strings, or none. Derivation only ever parses hex, so nothing raw reaches CSS.
- **Generated symbols keep their own colours**, with a thin drop-shadow in light themes so
  pale ones keep an edge.
- **Selected rows show numbers, durations and artists in `--text-secondary`**, since muted text
  isn't promised on the tint.
- **The playlist cover ignores Show Track Shapes** (the user's call): it's the playlist's own
  picture, not a track's.
- Not built: the window's pre-paint `backgroundColor` stays the default dark, so a light
  playlist restored at launch shows dark until its tab has loaded. The OS overlay's symbol PNG
  takes `--bg` when the track starts, so it doesn't repaint if the theme changes mid-track.

### Testing

`tests/unit/theme.test.mjs`: hex parsing, normalization, `tokens.css` against the derivation,
presets needing no adjustment, every pairing across 7,728 palettes (12³ hostile combinations
plus 6,000 seeded random ones, which caught a real miss: secondary text at 2.97:1 on a selected
row), light themes, lightness-only moves, and suggestions (including greyscale and fully
transparent images). `tests/e2e/phase9.steps.mjs` (23 checks): live preview, Escape, half-typed
and three-digit hex, the native picker, Enter, real Ctrl+Z / Ctrl+Y, a light preset, the
"Shown as" note, Suggest from Art off and cycling on real embedded art, back to no palette,
following the viewed tab with playback carrying on, save, close and reopen, a malformed palette.
