# MENUS.md — Beachday menu bar

The menu bar in the custom title bar (`src/renderer/components/TitleBar.jsx`), and where every
scoped feature lives in it. Agreed 2026-10-28.

This is a living spec: update it whenever a phase adds, moves, or drops a menu item. `PLAN.md`
holds the design behind each feature; this file only says *where it is reached from*.

**Legend:** the number after an item is the `PLAN.md` phase that delivers it. **✦** marks items
that were added during menu planning and aren't covered by an earlier design section. **⏳** marks
items that change once playlist tabs land (Phase 5, below).

Shortcuts follow Windows conventions (Ctrl), which match Linux. Beachday is used mainly on Windows.

---

## Bar

```
File · Edit · View · Playback · Playlist · Track · Options · Help
```

Changes from the Phase 1 placeholder (`File Edit View Playback Playlists Options`):

| Change | Why |
|---|---|
| **Playlists → Playlist** (singular) | It means "settings for the open playlist". Opening and saving live in File. |
| **+ Track** | Per-track curation is the product's core feature. It gets its own menu instead of being buried in Edit. |
| **+ Help** | Its most useful job is the sharing guide for Windows friends, plus a way to reach logs from packaged builds. |
| **Playback kept** | The transport bar covers play/pause/stop/prev/next/shuffle, but repeat modes, reshuffle, stop-after-current and a discoverable list of shortcuts have no other home. It's the first menu to drop if those move onto the transport bar later. |

---

## Menus

### File
| Item | Shortcut | Phase |
|---|---|---|
| New Playlist | Ctrl+N | 4 |
| Open Playlist… | Ctrl+O | 4 |
| Open Recent ▸ | | 4 |
| Save | Ctrl+S | 4 |
| Save As… | Ctrl+Shift+S | 4 |
| Export Bundled Copy… | | 4 |
| — | | |
| Add Files… | | 3 |
| Add Folder… | | 3 |
| — | | |
| Close Playlist | Ctrl+W | 4 ⏳ (becomes Close Tab) |
| Exit | | 1 |

**Export Bundled Copy** is the "send this to a friend" action. It writes a new `.bday` with the
audio inside and leaves your own reference-mode file untouched. Converting the open file in
place is **Playlist ▸ Storage**.

### Edit
| Item | Shortcut | Phase |
|---|---|---|
| Undo | Ctrl+Z | 4–5 ✦ |
| Redo | Ctrl+Y / Ctrl+Shift+Z | 4–5 ✦ |
| — | | |
| Cut / Copy / Paste | Ctrl+X / C / V | 5 |
| Select All | Ctrl+A | 5 |
| Remove from Playlist | Del | 5 |
| — | | |
| Find in Playlist… | Ctrl+F | ✦ |

**Undo/redo is confirmed in scope.** It covers every playlist edit: reorder, add, remove, link,
unlink, rename, art, gain, group changes and property edits. It doesn't cover playback state.
It must be designed into the playlist store from **Phase 4**, because every mutation has to go
through one undoable path. Retrofitting it later means touching every edit site. History is kept
per playlist.

### View
| Item | Shortcut | Phase |
|---|---|---|
| Art Pane ▸ **Art Only** / **Lyrics Only** / **Lyrics Over Art** | | 6 / 10 ✦ |
| Show Art Pane | | 6 |
| Reset Art Pane Size | | 6 |
| — | | |
| Collapse All Groups | | 5 |
| Expand All Groups | | 5 |
| Jump to Now Playing | Ctrl+J | 5 |
| — | | |
| Zoom In / Zoom Out / Reset Zoom | Ctrl+= / Ctrl+- / Ctrl+0 | — |

**Lyrics display lives in the art pane**, with three modes (a radio group; app-level preference,
not stored per playlist):

- **Art Only** — default.
- **Lyrics Only** — lyrics on a palette-derived background.
- **Lyrics Over Art** — white text with a dark outline and soft shadow so it reads over any
  artwork, plus an optional dimming layer over the art for very busy images.

LRCLIB returns synced `.lrc` timestamps, so the current line highlights and the view
auto-scrolls. Unsynced lyrics fall back to a static scrollable block. If no lyrics are found,
Lyrics Over Art shows the art alone, and Lyrics Only shows a "No lyrics found" message.

### Playback
| Item | Shortcut | Phase |
|---|---|---|
| Play / Pause | Space | 2 |
| Stop | | 2 |
| Previous / Next | | 2 |
| — | | |
| Order ▸ Sequential / Shuffle | | 2 / 8 |
| Repeat ▸ Off / All / One | | 8 |
| Reshuffle | | 8 |
| Stop After Current | | ✦ |
| — | | |
| Volume Up / Volume Down / Mute | | 2 |

**Reshuffle** builds a new shuffle order. It falls out of the permutation-cursor design
(`PLAN.md` §5).

### Playlist
Acts on the open playlist ⏳ (the viewed tab, once tabs land).

| Item | Phase |
|---|---|
| Properties… (name, description, author, cover) | 7 |
| Colors… (three-color palette) | 9 |
| — | |
| Grouping ▸ Off / By Album / By Artist / Custom… | 5 / 7 |
| Edit Groups… | 7 |
| Sort By ▸ (permanent reorder: title, artist, album, duration…) | ✦ |
| — | |
| Storage ▸ Reference / Bundled (converts this file in place) | 4 |
| Find Missing Tracks / Relink… | 4 |

### Track
Acts on the selected track(s). **The track list's right-click menu shows the same items.**

| Item | Shortcut | Phase |
|---|---|---|
| Rename… | F2 | 7 |
| Set Custom Art… | | 7 |
| Clear Custom Art | | 7 |
| Adjust Gain (dB)… (capped at +12dB — PLAN.md §10) | | 7 |
| Reset Gain | | 7 |
| — | | |
| Link Selected | Ctrl+L | 8 |
| Unlink | Ctrl+Shift+L | 8 |
| Move to Group ▸ (pins `groupId`, overriding auto-grouping) | | 7 |
| — | | |
| Fetch Lyrics | | 10 |
| Show in File Manager | | 3 |
| Properties… (read-only tags) | | 3 |
| — | | |
| Reset All Overrides | | 7 |

### Options
| Item | Phase |
|---|---|
| Preferences… (one settings window) | — |
| Fetch Lyrics Automatically (on/off) | 10 |
| Folder Mappings… (`C:\Music` ↔ `/home/…/Music`; app-level, not per playlist) | 4 |
| Pause GIFs When Window Is Unfocused (on/off) | 6 ✦ |

### Help
| Item | Phase |
|---|---|
| Keyboard Shortcuts | — |
| Sharing Guide (the Unblock-the-zip steps for Windows) | 10 |
| Open Log Folder | 10 ✦ |
| About Beachday (version info — replaces the Phase 1 smoke panel) | — |

**Open Log Folder** exists because packaged builds swallow stdout/stderr.
Main should log to a file, and this gives a friend a way to send that file to you.

---

## Playlist tabs

Designed in `PLAN.md` §5 (2026-10-28). Menu effects:

- File: **Close Playlist → Close Tab** (Ctrl+W), plus Next/Previous Tab (Ctrl+Tab / Ctrl+Shift+Tab). Phase 5.
- Options: **Restore Tabs on Startup** (on/off). Phase 5.
- Playlist, Edit and Track: act on the **viewed** tab. Cut/Copy/Paste move tracks between playlists.
- View: **Jump to Now Playing** switches to the playing tab.

---

## Implementation notes

**Built in Phase 4** from the table in `src/renderer/menus/commands.js`. Live now: all of File,
Edit ▸ Undo/Redo, View ▸ Zoom, Playback (except Order/Repeat/Reshuffle/Stop After Current),
Playlist ▸ Storage and Relink, Options ▸ Folder Mappings, Help ▸ Keyboard Shortcuts and About.
**Track** shows dimmed and doesn't open: every Track item acts on the selection, which arrives
in Phase 5. The empty playlist view keeps Add files/folder buttons as a convenience.

- The window is frameless, so these are **React dropdowns**, not a native `Menu`. Define every
  menu from **one data structure** (`id`, `label`, `shortcut`, `enabledWhen`, `action`) so that
  moving an item between menus is a one-line change, and so the Keyboard Shortcuts screen and
  the Track right-click menu read from the same source.
- Keyboard shortcuts are handled in the renderer from that same table. Media keys
  (play/pause/next/prev) come through `navigator.mediaSession` in the audio engine (Phase 2).
- Space (play/pause) is in the table; it's ignored while a button or slider has focus, since
  those already react to Space. All shortcuts are ignored while typing in a field or while a
  dialog is open.
- Items whose phase hasn't landed are **hidden, not disabled**, so the menus never advertise
  features that don't exist yet.
