import fs from 'node:fs';
const { readBday } = await import(new URL('../../src/main/bday.mjs', import.meta.url));

const PRE = `(async () => {
  const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
  const store = await mod('/src/renderer/store/playlists.js');
  const actions = await mod('/src/renderer/store/actions.js');
  const ui = await mod('/src/renderer/store/ui.js');
  const cmds = await mod('/src/renderer/menus/commands.js');
  const { player } = await mod('/src/renderer/audio/engine.js');
  const s = store.getState(); const p = s.playlists[s.viewedId]; const ps = player.getState();
  const summary = () => { const s = store.getState(); const p = s.playlists[s.viewedId]; const ps = player.getState();
    return { name: store.playlistName(p), dirty: store.isDirty(p), storage: p.storage, file: p.filePath?.split('/').pop() ?? null, n: p.doc.tracks.length, missing: store.missingCount(p),
      past: p.past.length, future: p.future.length, status: ps.status, idx: ps.index, title: ps.queue[ps.index]?.title ?? null, pos: +player.getPosition().toFixed(1), err: ps.error?.message ?? null,
      dialog: ui.getState().dialog, notice: ui.getState().notice, tabs: s.order.length, held: Object.keys(s.playlists).length, playingIsViewed: s.playingId === s.viewedId }; };
`;
const POST = `\n})()`;

export default async ({ w, answers, log, S, shot }) => {
  const H = S + '/home', M = H + '/Music';
  const flac = M + '/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', mp3 = M + '/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', wav = M + '/Breakcore/feel sooooo hard (renamed).wav';
  const R = (code) => w.webContents.executeJavaScript(PRE + code + POST);
  const sum = () => R('return summary();');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, cond, detail) => { if (!cond) throw new Error(`${name}\n    ${JSON.stringify(detail)}`); log('PASS', name); };
  const key = async (keyCode, modifiers = []) => { w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await sleep(150); };
  let s;

  // 1. Import, undo/redo by menu label and by keyboard.
  answers.push({ kind: 'open', value: [flac, mp3, wav] });
  s = await R('await actions.addFiles(); return summary();');
  check('import 3 tracks → dirty, one undo step', s.n === 3 && s.dirty && s.past === 1, s);
  const label = await R(`return cmds.resolveItem('edit.undo', cmds.getContext()).label;`);
  check('Edit menu says "Undo Add Tracks"', label === 'Undo Add Tracks', label);
  await key('Z', ['control']); s = await sum();
  check('Ctrl+Z undoes → empty and clean again', s.n === 0 && !s.dirty && s.future === 1, s);
  await key('Y', ['control']); s = await sum();
  check('Ctrl+Y redoes', s.n === 3 && s.dirty, s);

  // Menu screenshot: click File like a user.
  const rect = await w.webContents.executeJavaScript(`(() => { const r = [...document.querySelectorAll('.menubar__label')].find((b) => b.textContent === 'File').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  w.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
  w.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
  await sleep(300); await shot('menu-file');
  const items = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.menu__item')].map((i) => i.innerText.replace(/\\n/g, ' ').trim())`);
  check('File menu opens with its items', items.length >= 10 && items.some((t) => t.startsWith('Save As')), items);
  await key('Escape');

  // 2. Play the FLAC (album order: Breakcore wav, then Splatoon 2 mp3, Splatoon 3 flac).
  s = await R('{ const pp = store.getState().playlists[store.getState().viewedId]; store.play(pp.id, store.layoutOf(pp).order[2]); } await new Promise((r) => setTimeout(r, 1200)); player.seek(40); await new Promise((r) => setTimeout(r, 600)); return summary();');
  check('plays the FLAC', s.status === 'playing' && s.title === 'Cryogenic Hopetown' && s.pos >= 40, s);

  // 3. Save as reference.
  answers.push({ kind: 'save', value: H + '/Playlists/mix.bday' });
  s = await R('await actions.saveViewed(); return summary();');
  let bday = await readBday(H + '/Playlists/mix.bday');
  check('Save → clean, named after the file, reference paths relative', !s.dirty && s.name === 'mix' && s.storage === 'reference' && !bday.manifest.bundled && bday.manifest.tracks[2].relPath === '../Music/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', { s, rel: bday.manifest.tracks.map((t) => t.relPath) });

  // 4. Convert to bundled WHILE PLAYING, then seek (fresh range requests against the rewritten file).
  s = await R(`await actions.setStorage('bundled'); player.seek(150); await new Promise((r) => setTimeout(r, 900)); return summary();`);
  bday = await readBday(H + '/Playlists/mix.bday');
  check('Storage ▸ Bundled while playing: audio inside, playback continues past a seek', s.storage === 'bundled' && bday.manifest.bundled && bday.entries.size === 3 && s.status === 'playing' && s.pos > 150 && !s.err, { s, entries: [...bday.entries.keys()], size: fs.statSync(H + '/Playlists/mix.bday').size });
  s = await R(`player.previous(); await new Promise((r) => setTimeout(r, 400)); player.previous(); await new Promise((r) => setTimeout(r, 1200)); return summary();`);
  check('a track never loaded before streams straight out of the bundle', s.status === 'playing' && s.title === 'Fly Octo Fly' && s.pos > 0.5 && !s.err, s);

  // 5. Export a bundled copy; the open playlist is unaffected.
  answers.push({ kind: 'save', value: S + '/out/copy.bday' });
  s = await R(`await actions.saveViewed({ storage: 'bundled', copy: true }); return summary();`);
  const copy = await readBday(S + '/out/copy.bday');
  check('Export Bundled Copy writes elsewhere, playlist still mix.bday', s.file === 'mix.bday' && copy.manifest.bundled && copy.entries.size === 3 && /Exported/.test(s.notice), s);

  // 6. Back to reference: audio extracted, playback continues.
  answers.push({ kind: 'open', value: [H + '/Extracted'] });
  s = await R(`await actions.setStorage('reference'); player.seek(60); await new Promise((r) => setTimeout(r, 900)); return summary();`);
  bday = await readBday(H + '/Playlists/mix.bday');
  const extracted = fs.readdirSync(H + '/Extracted/mix audio');
  check('Storage ▸ Reference extracts the audio and keeps playing', s.storage === 'reference' && !bday.manifest.bundled && extracted.length === 3 && bday.manifest.tracks.every((t) => t.relPath.startsWith('../Extracted/mix audio/')) && s.status === 'playing' && s.pos > 60 && !s.err, { s, extracted, rel: bday.manifest.tracks.map((t) => t.relPath) });

  // 7. Open the playlist a friend made on Windows. Current one is clean → no prompt; it keeps playing out of sight.
  answers.push({ kind: 'open', value: [H + '/Downloads/inbox/from-windows.bday'] });
  s = await R('await actions.openPlaylist(); await new Promise((r) => setTimeout(r, 200)); return summary();');
  check('open Windows playlist in a new tab → all 4 missing, relink dialog opens, mix keeps playing', s.name === 'Friend’s Mix' && s.missing === 4 && s.dialog === 'relink' && s.tabs === 2 && s.held === 2 && s.status === 'playing' && !s.playingIsViewed, s);
  await shot('relink-before');
  answers.push({ kind: 'open', value: [flac] });
  const found = await R(`return await actions.locateTrack('w1');`);
  s = await sum();
  const config = JSON.parse(fs.readFileSync(S + '/userdata/config.json', 'utf8'));
  check('locating one track finds two more (mapping + fingerprint); one stays missing', found === 3 && s.missing === 1, { found, s });
  check('the learned folder mapping is saved in app config', config.folderMappings.some((m) => m.from === 'C:\\Users\\Me' && m.to === H), config.folderMappings);
  await shot('relink-after');
  await R('ui.closeDialog();');

  // 8. Double-click the truly missing track: clear message, no crash; the hidden playlist is released.
  s = await R('{ const pp = store.getState().playlists[store.getState().viewedId]; store.play(pp.id, store.layoutOf(pp).order[3]); } await new Promise((r) => setTimeout(r, 300)); return summary();');
  check('playing a missing track says so', s.status === 'stopped' && /missing/.test(s.err), s);
  s = await R('{ const pp = store.getState().playlists[store.getState().viewedId]; store.play(pp.id, store.layoutOf(pp).order[0]); } await new Promise((r) => setTimeout(r, 1200)); return summary();');
  check('relinked track plays', s.status === 'playing' && s.title === 'Cryogenic Hopetown' && !s.err, s);
  await shot('friend-playlist');

  // 9. Quit with unsaved changes: Cancel keeps the window, Don't Save closes it.
  answers.push({ kind: 'open', value: [wav] });
  s = await R('await actions.addFiles(); return summary();');
  check('edited → dirty', s.dirty && s.n === 5, s);
  answers.push({ kind: 'message', value: 2 });
  w.close(); await sleep(600);
  check('close → "Save changes?" → Cancel keeps the window', !w.isDestroyed() && answers.length === 0, answers);
  answers.push({ kind: 'message', value: 1 });
  const closed = new Promise((r) => w.once('closed', r));
  w.close();
  await Promise.race([closed, sleep(3000).then(() => { throw new Error('window did not close'); })]);
  check("close → Don't Save closes the window", true);
  log('ALL STEPS PASSED');
};
