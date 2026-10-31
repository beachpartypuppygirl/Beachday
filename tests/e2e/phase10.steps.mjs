// Phase 10: lyrics against a fake LRCLIB (one request at a time, only the playing and next tracks, the cache,
// nothing fetched in the .bday), the art pane's display modes, Edit Lyrics (in the .bday, undoable), Help.
import http from 'node:http';
import fs from 'node:fs';
const { readBday } = await import(new URL('../../src/main/bday.mjs', import.meta.url));

const PRE = `(async () => {
  const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
  const store = await mod('/src/renderer/store/playlists.js'); const actions = await mod('/src/renderer/store/actions.js');
  const ui = await mod('/src/renderer/store/ui.js'); const cmds = await mod('/src/renderer/menus/commands.js'); const { player } = await mod('/src/renderer/audio/engine.js');
  const P = () => { const s = store.getState(); return s.playlists[s.viewedId]; };
  const byTitle = (title) => P().doc.tracks.find((t) => t.tags.title === title);
  const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 6000) => { const t = performance.now(); while (!(await cond()) && performance.now() - t < ms) await tick(20); };
  const select = (title) => { const id = byTitle(title).id; store.setSelection(P().id, [id], { anchorId: id, focusId: id }); };
  const pane = () => ({ lines: [...document.querySelectorAll('.pane--art .lyrics__line')].map((e) => e.textContent), active: document.querySelector('.pane--art .lyrics')?.dataset.active ?? null,
    synced: document.querySelector('.pane--art .lyrics')?.dataset.synced ?? null, message: document.querySelector('.lyrics__message')?.textContent ?? null, over: Boolean(document.querySelector('.lyrics--over')),
    dim: Boolean(document.querySelector('.lyrics__dim')), art: Boolean(document.querySelector('.pane--art .art')) });
  const text = (value) => { const el = document.querySelector('.lyricsedit'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const button = (label) => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === label);
`;

export default async ({ w, answers, log, S }) => {
  const H = S + '/home', M = H + '/Music';
  const flac = M + '/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', mp3 = M + '/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', wav = M + '/Breakcore/feel sooooo hard (renamed).wav';
  const [F, Mp, Wv] = ['Cryogenic Hopetown', 'Fly Octo Fly', 'feel sooooo hard'];
  const R = (code) => w.webContents.executeJavaScript(PRE + code + '\n})()');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, cond, detail) => { if (!cond) throw new Error(`${name}\n    ${JSON.stringify(detail)}`); log('PASS', name); };
  const send = (e) => w.webContents.sendInputEvent(e);
  const key = async (keyCode, modifiers = []) => { send({ type: 'keyDown', keyCode, modifiers }); send({ type: 'char', keyCode, modifiers }); send({ type: 'keyUp', keyCode, modifiers }); await sleep(150); };
  let s;

  // A fake LRCLIB. `asked` is every lookup it saw, by track.
  let asked = [];
  let answer = (title) => ({ syncedLyrics: `[00:00.00] ${title} one\n[00:01.00] ${title} two\n[00:60.00] ${title} three`, plainLyrics: `${title} one`, instrumental: false });
  let inFlight = 0, most = 0, agents = new Set(), status = 200;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://x');
    asked.push(url.searchParams.get('track_name'));
    agents.add(request.headers['user-agent']);
    most = Math.max(most, ++inFlight);
    await sleep(20);
    inFlight--;
    const record = answer(url.searchParams.get('track_name'));
    if (status !== 200) { response.writeHead(status, { 'Retry-After': '1' }); return response.end('{}'); }
    if (!record) { response.writeHead(404); return response.end('{}'); }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(url.pathname.endsWith('/search') ? [] : record));
  });
  await new Promise((r) => server.listen(5198, '127.0.0.1', r));

  answers.push({ kind: 'open', value: [flac, mp3, wav] });
  await R(`await actions.addFiles(); player.setOrder('sequential'); player.setRepeat('off'); store.moveTracksTo(P().id, [byTitle('${F}').id, byTitle('${Mp}').id, byTitle('${Wv}').id], {});`);

  // --- Off by default ---
  s = await R(`const viewMenu = cmds.resolveItem(cmds.MENUS.find((m) => m.label === 'View').items[0], cmds.getContext());
    return { auto: ui.getState().fetchLyrics, mode: ui.getState().artPaneMode, label: viewMenu.label, items: viewMenu.items.filter((i) => i !== '-').map((i) => cmds.resolveItem(i, cmds.getContext()).label),
      help: cmds.MENUS.find((m) => m.label === 'Help').items, options: cmds.MENUS.find((m) => m.label === 'Options').items[0] };`);
  check('View ▸ Art Pane has the modes; automatic lyrics are off by default', s.auto === false && s.mode === 'art' && s.label === 'Art Pane' && s.items.join() === 'Art Only,Lyrics Only,Lyrics Over Art,Dim Art Behind Lyrics' && s.options === 'options.fetchLyrics', s);
  await R(`ui.setArtPaneMode('lyrics'); store.play(P().id, byTitle('${F}').id); await until(() => player.getState().status === 'playing'); await tick(2000);`);
  s = await R(`return pane();`);
  check('with it off, playing a track asks nobody', asked.length === 0, asked);
  check('…and Lyrics Only says what to do', s.message?.includes('Fetch Lyrics Automatically') && s.lines.length === 0 && !s.art, s);

  // --- Automatic: only what's playing, then only what's next ---
  await R(`actions.toggleFetchLyrics(); await until(() => document.querySelectorAll('.lyrics__line').length > 0); await tick(250);`);
  s = await R(`return { pane: pane(), position: player.getPosition(), config: (await window.beachday.prefs.get()).fetchLyrics };`);
  check('turning it on looks up the playing track, once, and no other', asked.join() === F && s.config === true, { asked, s });
  check('…who the app is goes along', agents.size === 1 && /^Beachday v\d/.test([...agents][0]), [...agents]);
  check('…synced lyrics show, with the current line marked', s.pane.synced === 'true' && s.pane.lines.length === 3 && Number(s.pane.active) === 1, s);
  // Smooth scrolling needs frames, which a never-shown window barely has, so measure without it.
  await R(`document.querySelector('.lyrics').style.scrollBehavior = 'auto'; player.seek(30); await until(() => document.querySelector('.lyrics').dataset.active === '1', 3000);
    player.seek(61); await until(() => document.querySelector('.lyrics').dataset.active === '2', 3000); await tick(150);`);
  s = await R(`const box = document.querySelector('.lyrics'); const line = box.children[2];
    return { active: box.dataset.active, marked: line.classList.contains('lyrics__line--active'), scrollTop: box.scrollTop, height: box.clientHeight, top: line.offsetTop,
      centred: Math.abs(line.offsetTop + line.offsetHeight / 2 - box.scrollTop - box.clientHeight / 2) < 3 };`);
  check('…seeking moves the marked line, and it stays centred', s.active === '2' && s.marked && s.centred, s);

  await R(`player.seek(player.getState().duration - 8); await until(() => player.getState().upcoming);`);
  s = await R(`return { upcoming: player.getState().upcoming?.title, current: player.getState().current?.title };`);
  check('in the final seconds, the engine says what it’s preparing', s.upcoming === Mp && s.current === F, s);
  await sleep(2100);
  check('…and that track is looked up too, but not the one after', asked.join() === `${F},${Mp}`, asked);

  // Skipping past: Next twice quickly lands on the third, and the second was cached anyway.
  asked = [];
  await R(`store.play(P().id, byTitle('${Wv}').id); await tick(100); store.play(P().id, byTitle('${F}').id); await tick(100); store.play(P().id, byTitle('${Wv}').id); await tick(100); store.play(P().id, byTitle('${Mp}').id); await tick(2000);`);
  s = await R(`return pane();`);
  check('a track skipped straight past is never looked up, and cached ones aren’t asked again', asked.length === 0, asked);
  check('…the cached lyrics show straight away', s.lines[0] === `${Mp} one`, s);
  await R(`store.play(P().id, byTitle('${Wv}').id); await until(() => document.querySelector('.lyrics__line')?.textContent.startsWith('${Wv}')); await tick(100);`);
  check('a track that stays gets its turn', asked.join() === Wv, asked);
  check('requests never overlap', most === 1, most);

  // --- Nothing found, instrumental ---
  answer = () => null;
  asked = [];
  answers.length = 0;
  answers.push({ kind: 'open', value: [flac] });
  await R(`ui.setFetchLyrics(false); await actions.newPlaylist(); await actions.addFiles(); await tick(100);
    const t = P().doc.tracks[0]; store.mergeResolution(P().id, {}); store.renameTrack(P().id, t.id, 'A New Name'); select('${F}');`);
  answer = (title) => ({ instrumental: true, syncedLyrics: null, plainLyrics: null });
  s = await R(`cmds.runCommand('track.fetchLyrics'); await until(() => /instrumental/i.test(ui.getState().notice ?? '')); return { notice: ui.getState().notice };`);
  check('Track ▸ Fetch Lyrics asks for that one track, even with automatic off, and says how it went', /"A New Name" is marked as instrumental/.test(s.notice ?? '') && asked.join() === F, { s, asked });
  check('…by the file’s own title, not the playlist’s rename', asked.join() === F, asked);
  answer = (title) => ({ syncedLyrics: `[00:00.00] ${title} again`, plainLyrics: null, instrumental: false });
  status = 429;
  s = await R(`cmds.runCommand('track.fetchLyrics'); await until(() => /Couldn/.test(ui.getState().notice ?? '')); return ui.getState().notice;`);
  check('told to wait, it says so', /Couldn’t reach/.test(s), s);
  status = 200;
  await sleep(1100);
  s = await R(`cmds.runCommand('track.fetchLyrics'); await until(() => /Lyrics found/.test(ui.getState().notice ?? '')); return ui.getState().notice;`);
  check('…and works again once the wait is over', /Lyrics found/.test(s), s);
  await R(`const dup = P().id; store.revertToSaved(dup); actions.closeViewed(); await tick();`);

  // --- Lyrics Over Art ---
  await R(`ui.setArtPaneMode('over'); store.play(P().id, byTitle('${Mp}').id); await until(() => document.querySelector('.lyrics--over')); await tick();`);
  s = await R(`const el = document.querySelector('.lyrics--over'); return { pane: pane(), color: getComputedStyle(el).color };`);
  check('Lyrics Over Art: white text over the art, dimmed', s.pane.over && s.pane.art && s.pane.dim && s.color === 'rgb(255, 255, 255)', s);
  await R(`cmds.runCommand('view.dimArt'); await tick();`);
  s = await R(`return pane();`);
  check('…dimming is optional', s.over && !s.dim, s);
  await R(`cmds.runCommand('view.dimArt'); await tick();`);
  s = await R(`const before = player.getState().status; document.querySelector('.pane--art').click(); await tick(); const after = player.getState().status; document.querySelector('.pane--art').click(); await tick(); return { before, after };`);
  check('…and a click on the pane still toggles playback', s.before === 'playing' && s.after === 'paused', s);

  // --- Edit Lyrics ---
  await R(`select('${Wv}'); cmds.runCommand('track.editLyrics'); await tick();`);
  s = await R(`const el = document.querySelector('.lyricsedit'); const value = el.value; const focused = document.activeElement === el; button('Save').click(); await tick(); return { value, focused, overrides: byTitle('${Wv}').overrides, dirty: store.isDirty(P()) };`);
  check('Edit Lyrics opens on the fetched lyrics; saving them unchanged stores nothing', s.value.includes(`${Wv} one`) && s.focused && !('lyrics' in s.overrides), s);

  await R(`select('${Mp}'); store.play(P().id, byTitle('${Mp}').id); await tick(); cmds.runCommand('track.editLyrics'); await tick(); text('My first line\\n\\nMy second line'); button('Save').click(); await until(() => pane().lines[0] === 'My first line');`);
  s = await R(`return { pane: pane(), lyrics: byTitle('${Mp}').overrides.lyrics, undo: cmds.resolveItem('edit.undo', cmds.getContext()).label, props: (cmds.runCommand('track.properties'), await tick(), document.querySelector('.modal').textContent) };`);
  check('pasted lyrics replace the fetched ones at once, as an undoable edit', s.lyrics === 'My first line\n\nMy second line' && s.undo === 'Undo Edit Lyrics', s);
  check('…plain lyrics are a block, with no marked line', s.pane.synced === 'false' && s.pane.lines.length === 3 && s.pane.lines[1].trim() === '', s);
  check('…Track Properties says where they live', s.props.includes('Saved in this playlist'), s.props);
  await R(`ui.closeDialog(); await tick();`);
  await key('Z', ['control']);
  s = await R(`return { pane: pane(), lyrics: byTitle('${Mp}').overrides.lyrics ?? null };`);
  check('Ctrl+Z brings the fetched lyrics back', s.lyrics === null && s.pane.lines[0] === `${Mp} one`, s);
  await key('Y', ['control']);
  await R(`cmds.runCommand('track.editLyrics'); await tick(); text('[00:00.00] Timed line'); button('Save').click(); await until(() => pane().synced === 'true');`);
  s = await R(`return pane();`);
  check('pasted timestamps make them synced', s.lines.join() === 'Timed line', s);

  // --- What's in the .bday ---
  const file = H + '/Playlists/p10.bday';
  answers.push({ kind: 'save', value: file });
  await R(`await actions.saveViewed();`);
  const saved = await readBday(file);
  const json = JSON.stringify(saved.manifest);
  check('pasted lyrics are in the .bday', saved.manifest.tracks.find((t) => t.overrides.lyrics)?.overrides.lyrics === '[00:00.00] Timed line', saved.manifest.tracks.map((t) => t.overrides));
  check('…fetched lyrics are not', !json.includes(`${Wv} one`) && !json.includes(`${F} one`), json.slice(0, 300));

  // A friend: no cache at all, automatic off, the same .bday.
  await R(`player.stop(); store.getState().order.forEach((id) => store.revertToSaved(id)); actions.closeViewed(); await tick();`);
  fs.rmSync(S + '/userdata/lyrics-cache', { recursive: true, force: true });
  answers.push({ kind: 'open', value: [file] });
  asked = [];
  await R(`await actions.openPlaylist(); await tick(); store.play(P().id, byTitle('${Mp}').id); await until(() => pane().lines.length > 0);`);
  s = await R(`return pane();`);
  check('reopened, pasted lyrics show with no cache and no request', s.lines.join() === 'Timed line' && asked.length === 0, { s, asked });

  await R(`select('${Mp}'); cmds.runCommand('track.editLyrics'); await tick(); button('Remove from Playlist').click(); await tick();`);
  s = await R(`return byTitle('${Mp}').overrides.lyrics ?? null;`);
  check('Remove from Playlist takes them out', s === null, s);
  await R(`actions.undo(); await tick(); cmds.runCommand('track.resetOverrides'); await tick();`);
  s = await R(`return byTitle('${Mp}').overrides.lyrics ?? null;`);
  check('Reset All Overrides clears them too', s === null, s);

  // --- Help, logs, prefs ---
  await R(`cmds.runCommand('help.sharing'); await tick();`);
  s = await R(`const t = document.querySelector('.modal').textContent; ui.closeDialog(); await tick(); return t;`);
  check('Help ▸ Sharing Guide covers playlists and both platforms', s.includes('Export Bundled Copy') && s.includes('Unblock') && s.includes('chmod +x') && s.includes('fetch its own'), s.slice(0, 200));
  check('a log file exists, for Help ▸ Open Log Folder', fs.readFileSync(S + '/userdata/logs/beachday.log', 'utf8').includes('Beachday '), null);
  await R(`ui.setArtPaneMode('lyrics'); await tick(200);`);
  const config = JSON.parse(fs.readFileSync(S + '/userdata/config.json', 'utf8'));
  check('the art pane mode persists', config.artPaneMode === 'lyrics' && config.dimLyricsArt === true, config);

  server.close();
  await R(`player.stop(); for (const id of store.getState().order) store.revertToSaved(id);`);
  w.close();
  await new Promise((r) => w.once('closed', r));
  log('ALL STEPS PASSED');
};
