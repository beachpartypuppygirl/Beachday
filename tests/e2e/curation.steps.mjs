// Curation at scale: Move to Group with many groups near the window's edges, Edit Tags and Swap
// Artist and Album (one track and many, live on the playing track, in the .bday, never in the file),
// the now playing label, and selecting a group's tracks without the group.
import fs from 'node:fs';
const { readBday } = await import(new URL('../../src/main/bday.mjs', import.meta.url));

const PRE = `(async () => {
  const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
  const store = await mod('/src/renderer/store/playlists.js'); const actions = await mod('/src/renderer/store/actions.js');
  const ui = await mod('/src/renderer/store/ui.js'); const cmds = await mod('/src/renderer/menus/commands.js'); const { player } = await mod('/src/renderer/audio/engine.js');
  const P = () => { const s = store.getState(); return s.playlists[s.viewedId]; };
  const byTitle = (title) => P().doc.tracks.find((t) => t.tags.title === title);
  const tick = () => new Promise((r) => setTimeout(r, 60));
  const button = (text) => { const el = [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === text); el?.click(); return Boolean(el); };
  const field = (label) => [...document.querySelectorAll('.modal label')].find((l) => l.textContent.startsWith(label)).querySelector('input');
  const fill = (label, value) => { const input = field(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
  const nowText = () => [...document.querySelector('.transport__now').children].map((e) => e.textContent);
`;

export default async ({ w, answers, log, S }) => {
  const H = S + '/home', M = H + '/Music';
  const flac = M + '/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', mp3 = M + '/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', wav = M + '/Breakcore/feel sooooo hard (renamed).wav';
  const R = (code) => w.webContents.executeJavaScript(PRE + code + '\n})()');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, cond, detail) => { if (!cond) throw new Error(`${name}\n    ${JSON.stringify(detail)}`); log('PASS', name); };
  const send = (e) => w.webContents.sendInputEvent(e);
  const rightClick = async (p) => { send({ type: 'mouseMove', ...p }); send({ type: 'mouseDown', ...p, button: 'right', clickCount: 1 }); send({ type: 'mouseUp', ...p, button: 'right', clickCount: 1 }); await sleep(200); };
  const click = async (p) => { send({ type: 'mouseMove', ...p }); send({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 }); send({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); await sleep(200); };
  const centre = (selector, text) => w.webContents.executeJavaScript(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text ?? '')})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()`);
  const closeMenu = async () => { send({ type: 'keyDown', keyCode: 'Escape' }); send({ type: 'keyUp', keyCode: 'Escape' }); await sleep(120); };
  let s;

  answers.push({ kind: 'open', value: [flac, mp3, wav] });
  await R('await actions.addFiles(); document.querySelector(".tracklist__scroll").focus();');
  const fileBytes = fs.readFileSync(mp3);

  // --- Edit Tags: one track ---
  await R(`store.setSelection(P().id, [byTitle('Fly Octo Fly').id]); await tick(); cmds.runCommand('track.editTags'); await tick();`);
  s = await R(`return { dialog: ui.getState().dialog, artist: field('Artist').value, album: field('Album').value, reset: [...document.querySelectorAll('.modal button')].some((b) => b.textContent.includes('Reset')) };`);
  check('Edit Tags opens on the track’s tags, with nothing to reset yet', s.dialog === 'tags' && s.artist === 'Splatoon 2: Octo Expansion' && s.album === 'Splatoon' && !s.reset, s);
  await R(`store.play(P().id, byTitle('Fly Octo Fly').id); await until(); fill('Artist', 'Off the Hook'); await tick(); button('Apply'); await tick();
    async function until() { for (let i = 0; i < 100 && player.getState().status !== 'playing'; i++) await new Promise((r) => setTimeout(r, 20)); }`);
  s = await R(`const t = byTitle('Fly Octo Fly'); return { overrides: t.overrides, tag: t.tags.artist, current: player.getState().current.artist, undo: cmds.resolveItem('edit.undo', cmds.getContext()).label, dirty: store.isDirty(P()) };`);
  check('…and sets it in the playlist, on the playing track too, as one undo step', s.overrides.artist === 'Off the Hook' && !('album' in s.overrides) && s.tag === 'Splatoon 2: Octo Expansion' && s.current === 'Off the Hook' && s.undo === 'Undo Edit Tags' && s.dirty, s);
  s = await R(`document.querySelector('.tracklist__scroll').focus(); cmds.runCommand('track.properties'); await tick(); const text = document.querySelector('.modal').innerText; ui.closeDialog(); return text;`);
  check('Properties shows the file’s tag and the playlist’s, separately', s.includes('Splatoon 2: Octo Expansion') && s.includes('Off the Hook'), s);

  // --- Now playing label ---
  s = await R(`return nowText();`);
  check('the label starts as the album, then the title', s.join('|') === 'Splatoon|Fly Octo Fly', s);
  await click(await centre('.menubar__label', 'View'));
  send({ type: 'mouseMove', ...(await centre('.menubar .menu__entry', 'Now Playing Label')) });
  await sleep(200);
  await click(await centre('.menu--nested [role=menuitem]', 'Artist and Album'));
  s = await R(`return { text: nowText(), prefs: await window.beachday.prefs.get() };`);
  check('View ▸ Now Playing Label ▸ Artist and Album shows both, and is remembered', s.text.join('|') === 'Off the Hook|Splatoon|Fly Octo Fly' && s.prefs.nowPlayingLabel === 'both', s);
  await rightClick(await centre('.transport__now'));
  s = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.contextmenu [role=menuitem]')].map((e) => e.textContent)`);
  check('right-clicking the label offers the same three', s.length === 3 && s[2].includes('Artist and Album') && s[2].includes('✓'), s);
  await click(await centre('.contextmenu [role=menuitem]', 'Artist'));
  s = await R(`return { text: nowText(), menu: Boolean(document.querySelector('.contextmenu')), title: document.querySelector('.transport__now').title };`);
  check('…and choosing Artist shows just the artist', s.text.join('|') === 'Off the Hook|Fly Octo Fly' && !s.menu && s.title === 'Off the Hook — Fly Octo Fly', s);
  s = await R(`ui.setNowPlayingLabel('album'); store.undo(P().id); await tick(); await tick(); ui.setNowPlayingLabel('artist'); await tick(); return nowText();`);
  check('undo reaches the playing track', s.join('|') === 'Splatoon 2: Octo Expansion|Fly Octo Fly', s);
  await R(`player.stop(); ui.setNowPlayingLabel('album');`);

  // --- Edit Tags and Swap: many tracks ---
  await R(`store.selectAll(P().id); await tick(); cmds.runCommand('track.editTags'); await tick();`);
  s = await R(`const title = document.querySelector('.modal__title').textContent; return { title, artist: field('Artist').value, holder: field('Artist').placeholder, label: cmds.resolveItem('track.editTags', cmds.getContext()).label };`);
  check('with several tracks, a field they disagree on starts blank and says so', s.title === 'Tags for 3 tracks' && s.artist === '' && s.holder.includes('Multiple') && s.label === 'Edit Tags for 3 Tracks…', s);
  await R(`fill('Album', 'Beach Mix'); await tick(); button('Apply'); await tick();`);
  s = await R(`return P().doc.tracks.map((t) => ({ a: t.overrides.artist, album: t.overrides.album }));`);
  check('only the changed field applies, to every selected track', s.every((t) => t.album === 'Beach Mix' && t.a === undefined), s);

  await R(`cmds.runCommand('track.swapTags'); await tick();`);
  s = await R(`return { rows: P().doc.tracks.map((t) => [t.tags.title, store.trackView(t, {}).artist, store.trackView(t, {}).album]), undo: cmds.resolveItem('edit.undo', cmds.getContext()).label };`);
  check('Swap Artist and Album exchanges each track’s own two values', s.rows.every(([, artist]) => artist === 'Beach Mix') && s.rows.find((r) => r[0] === 'Fly Octo Fly')[2] === 'Splatoon 2: Octo Expansion' && s.undo === 'Undo Swap Artist and Album', s);

  // Saved in the playlist, and the music untouched.
  const out = H + '/Playlists/tags.bday';
  answers.push({ kind: 'save', value: out });
  await R(`await actions.saveViewed({ saveAs: true }); await tick();`);
  const manifest = (await readBday(out)).manifest;
  check('the tags are in the .bday', manifest.tracks.every((t) => t.overrides.artist === 'Beach Mix'), manifest.tracks.map((t) => t.overrides));
  check('the music file hasn’t changed', fileBytes.equals(fs.readFileSync(mp3)));

  await R(`cmds.runCommand('playlist.grouping.album'); await tick(); await tick();`);
  s = await R(`return store.layoutOf(P()).groups.map((g) => g.mainName);`);
  check('grouping by album follows the edited tags', s.includes('Splatoon 2: Octo Expansion') && !s.includes('Splatoon'), s);

  await R(`store.selectAll(P().id); await tick(); cmds.runCommand('track.editTags'); await tick(); button('Reset to File Tags'); await tick();`);
  s = await R(`return { overrides: P().doc.tracks.map((t) => t.overrides), groups: store.layoutOf(P()).groups.map((g) => g.mainName) };`);
  check('Reset to File Tags takes them all back', s.overrides.every((o) => !('artist' in o) && !('album' in o)) && s.groups.includes('Splatoon'), s);

  // --- Select All Tracks in Group ---
  await R(`store.setTrackTags(P().id, [byTitle('Fly Octo Fly').id, byTitle('Cryogenic Hopetown').id], { artist: 'Splatoon' }); store.setSelection(P().id, []); await tick(); await tick();`);
  s = await R(`return store.layoutOf(P()).groups.find((g) => g.mainName === 'Splatoon').key;`);
  const key = s;
  const header = await centre('.group', 'Splatoon');
  await rightClick(header);
  s = await w.webContents.executeJavaScript(`document.querySelector('.contextmenu [role=menuitem]').textContent`);
  check('right-clicking a header offers Select All Tracks in Group first', s.includes('Select All Tracks in Group'), s);
  await click(await centre('.contextmenu [role=menuitem]', 'Select All Tracks in Group'));
  s = await R(`const group = store.layoutOf(P()).groups.find((g) => g.mainName === 'Splatoon'); await tick();
    return { selected: store.selectedIds(P()), ids: group.trackIds, lit: document.querySelectorAll('.group--selected').length, rows: document.querySelectorAll('.track--selected').length };`);
  check('…which selects its tracks and leaves the header unlit', s.selected.length === 2 && s.selected.join() === s.ids.join() && s.lit === 0 && s.rows === 2, s);
  s = await R(`return { add: cmds.resolveItem('track.setArt', cmds.getContext()).label };`);
  check('…so track commands see them as a selection', s.add === 'Set Custom Art for 2 Tracks…', s);
  await click(header);
  s = await R(`await tick(); return document.querySelectorAll('.group--selected').length;`);
  check('clicking the header still selects the group, lit', s === 1, s);
  await R(`store.setSelection(P().id, []); store.toggleCollapsed(P().id, ${JSON.stringify(key)}); await tick();`);
  await rightClick(header);
  await click(await centre('.contextmenu [role=menuitem]', 'Select All Tracks in Group'));
  s = await R(`await tick(); return { rows: document.querySelectorAll('.track--selected').length, collapsed: P().view.collapsed.has(${JSON.stringify(key)}) };`);
  check('a collapsed group opens to show its selected tracks', s.rows === 2 && !s.collapsed, s);

  // --- Move to Group with many groups, near the window's edges ---
  await R(`const [template] = P().doc.tracks;
    store.edit(P().id, 'Fill', (doc) => {
      const groups = Array.from({ length: 70 }, (_, i) => ({ key: 'custom:g_' + i, custom: true, mainName: 'Group ' + i }));
      const tracks = Array.from({ length: 280 }, (_, i) => ({ ...template, id: 'x' + i, groupId: 'custom:g_' + (i % 70), linkNext: null }));
      return { ...doc, grouping: { ...doc.grouping }, groups, tracks };
    });
    await tick(); const list = document.querySelector('.tracklist__scroll'); list.scrollTop = list.scrollHeight;`);
  // Never-shown windows run the virtualizer's frames about once a second.
  const lowest = () => w.webContents.executeJavaScript(`(() => { const box = document.querySelector('.tracklist__scroll').getBoundingClientRect(); const r = [...document.querySelectorAll('.track')].map((e) => e.getBoundingClientRect()).filter((row) => row.top >= box.top && row.bottom <= box.bottom).at(-1); return r ? { x: Math.round(r.left + 200), y: Math.round(r.top + 8) } : null; })()`);
  await sleep(1500);
  const nested = () => w.webContents.executeJavaScript(`(() => {
    const list = document.querySelector('.menu--nested'); const r = list.getBoundingClientRect();
    const items = [...list.querySelectorAll('[role=menuitem]')]; const first = items[0].getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: innerWidth, height: innerHeight, count: items.length, firstLabel: items[0].textContent, firstBottom: first.bottom, scrolls: list.scrollHeight > list.clientHeight };
  })()`);
  await rightClick(await lowest());
  send({ type: 'mouseMove', ...(await centre('.contextmenu [role=menuitem]', 'Move to Group')) });
  await sleep(250);
  s = await nested();
  check('near the bottom of a long list, Move to Group stays inside the window', s.top >= 0 && s.bottom <= s.height, s);
  check('…with New Group… first, in reach without scrolling', s.firstLabel.includes('New Group') && s.firstBottom <= s.height, s);
  check('…and every group listed, not just the first 40', s.count === 72 && s.scrolls, s);
  s = await w.webContents.executeJavaScript(`(() => { const list = document.querySelector('.menu--nested'); list.scrollTop = list.scrollHeight; const last = [...list.querySelectorAll('[role=menuitem]')].at(-1); const r = last.getBoundingClientRect(); return { text: last.textContent, bottom: r.bottom, height: innerHeight }; })()`);
  check('…and scrolling reaches the last one', s.text.includes('Group 69') && s.bottom <= s.height, s);
  await click(await centre('.menu--nested [role=menuitem]', 'Group 69'));
  s = await R(`return { group: store.selectedIds(P()).map((id) => P().doc.tracks.find((t) => t.id === id).groupId) };`);
  check('…and choosing it moves the track', s.group.every((id) => id === 'custom:g_69') && s.group.length > 0, s);

  // Hard against the right edge the submenu has no room, so it opens to the left.
  const row = await lowest();
  const size = await w.webContents.executeJavaScript('({ x: innerWidth })');
  await rightClick({ x: size.x - 30, y: row.y });
  send({ type: 'mouseMove', ...(await centre('.contextmenu [role=menuitem]', 'Move to Group')) });
  await sleep(250);
  s = await nested();
  check('near the right edge it opens to the left, still inside the window', s.left >= 0 && s.right <= s.width, s);
  await closeMenu();
  await closeMenu();

  await R(`for (const id of store.getState().order) store.revertToSaved(id);`);
  w.close();
  await new Promise((r) => w.once('closed', r));
  log('ALL STEPS PASSED');
};
