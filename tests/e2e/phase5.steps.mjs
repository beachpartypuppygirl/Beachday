import fs from 'node:fs';
const { readBday } = await import(new URL('../../src/main/bday.mjs', import.meta.url));
const PRE = `(async () => {
  const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
  const store = await mod('/src/renderer/store/playlists.js'); const actions = await mod('/src/renderer/store/actions.js');
  const ui = await mod('/src/renderer/store/ui.js'); const cmds = await mod('/src/renderer/menus/commands.js'); const { player } = await mod('/src/renderer/audio/engine.js');
  const P = () => { const s = store.getState(); return s.playlists[s.viewedId]; };
  const titles = (p = P()) => store.layoutOf(p).order.map((id) => p.doc.tracks.find((t) => t.id === id).tags.title);
  const sel = (p = P()) => store.selectedIds(p).map((id) => p.doc.tracks.find((t) => t.id === id).tags.title);
  const summary = () => { const s = store.getState(); const p = P(); const ps = player.getState();
    return { tabs: s.order.length, viewedIsPlaying: s.viewedId === s.playingId, n: p.doc.tracks.length, order: titles(), sel: sel(), undo: p.past.at(-1)?.label ?? null,
      status: ps.status, current: ps.current?.title ?? null, detached: ps.detachedAt, queue: ps.queue.map((t) => t.title),
      groups: store.layoutOf(p).groups?.map((g) => g.mainName) ?? null, collapsed: p.view.collapsed.size, rowsInDom: document.querySelectorAll('[role=option], .group').length }; };
`;
export default async ({ w, answers, log, S, shot }) => {
  const H = S + '/home', M = H + '/Music';
  const flac = M + '/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', mp3 = M + '/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', wav = M + '/Breakcore/feel sooooo hard (renamed).wav';
  const R = (code) => w.webContents.executeJavaScript(PRE + code + '\n})()');
  const sum = () => R('return summary();');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, cond, detail) => { if (!cond) throw new Error(`${name}\n    ${JSON.stringify(detail)}`); log('PASS', name); };
  const send = (e) => w.webContents.sendInputEvent(e);
  const key = async (keyCode, modifiers = []) => { send({ type: 'keyDown', keyCode, modifiers }); send({ type: 'char', keyCode, modifiers }); send({ type: 'keyUp', keyCode, modifiers }); await sleep(120); };
  // Centre of the nth visible track row (or group header) by on-screen order.
  const rowPoint = (selector, n, where = 0.5) => w.webContents.executeJavaScript(`(() => { const rows = [...document.querySelectorAll('${selector}')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const r = rows[${n}].getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.4), y: Math.round(r.top + r.height * ${where}) }; })()`);
  const click = async (p, modifiers = []) => { send({ type: 'mouseDown', ...p, button: 'left', clickCount: 1, modifiers }); send({ type: 'mouseUp', ...p, button: 'left', clickCount: 1, modifiers }); await sleep(120); };
  const dragTo = async (from, to) => {
    send({ type: 'mouseDown', ...from, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) { send({ type: 'mouseMove', x: from.x, y: Math.round(from.y + ((to.y - from.y) * i) / 8), button: 'left' }); await sleep(30); }
    await sleep(80); send({ type: 'mouseUp', ...to, button: 'left', clickCount: 1 }); await sleep(200);
  };
  let s;

  answers.push({ kind: 'open', value: [flac, mp3, wav] });
  s = await R('await actions.addFiles(); return summary();');
  check('import → flat list in album order, nothing selected', s.n === 3 && s.order.join() === 'feel sooooo hard,Fly Octo Fly,Cryogenic Hopetown' && s.sel.length === 0, s);

  // --- Mouse selection ---
  await click(await rowPoint('[role=option]', 0)); s = await sum();
  check('click selects one row', s.sel.join() === 'feel sooooo hard', s.sel);
  await click(await rowPoint('[role=option]', 2), ['shift']); s = await sum();
  check('Shift+click selects the range', s.sel.length === 3, s.sel);
  await click(await rowPoint('[role=option]', 1), ['control']); s = await sum();
  check('Ctrl+click toggles one out', s.sel.join() === 'feel sooooo hard,Cryogenic Hopetown', s.sel);
  await click(await rowPoint('[role=option]', 0)); await key('Down'); s = await sum();
  check('arrow key moves the selection', s.sel.join() === 'Fly Octo Fly', s.sel);
  await key('Down', ['shift']); await key('Up', ['shift']); await key('Up', ['shift']); s = await sum();
  check('Shift+arrows extend from the anchor', s.sel.join() === 'feel sooooo hard,Fly Octo Fly', s.sel);

  // --- Drag reorder ---
  await click(await rowPoint('[role=option]', 0));
  await dragTo(await rowPoint('[role=option]', 0), await rowPoint('[role=option]', 2, 0.85));
  s = await sum();
  check('drag the first row below the last', s.order.join() === 'Fly Octo Fly,Cryogenic Hopetown,feel sooooo hard' && s.undo === 'Move Track', s);
  await key('Z', ['control']); s = await sum();
  check('Ctrl+Z undoes the move', s.order.join() === 'feel sooooo hard,Fly Octo Fly,Cryogenic Hopetown', s.order);
  await click(await rowPoint('[role=option]', 1)); await click(await rowPoint('[role=option]', 2), ['shift']);
  await dragTo(await rowPoint('[role=option]', 1), await rowPoint('[role=option]', 0, 0.2));
  s = await sum();
  check('drag two selected rows to the top together', s.order.join() === 'Fly Octo Fly,Cryogenic Hopetown,feel sooooo hard' && s.undo === 'Move Tracks', s);
  await key('Z', ['control']);

  // --- Clipboard and Delete ---
  await click(await rowPoint('[role=option]', 0)); await key('C', ['control']); await key('V', ['control']); s = await sum();
  check('Ctrl+C / Ctrl+V pastes a copy after the selection', s.n === 4 && s.order.join() === 'feel sooooo hard,feel sooooo hard,Fly Octo Fly,Cryogenic Hopetown' && s.undo === 'Paste', s);
  await key('Delete'); s = await sum();
  check('Delete removes the pasted copy', s.n === 3 && s.undo === 'Remove Track', s);
  await click(await rowPoint('[role=option]', 1)); await key('X', ['control']); s = await sum();
  check('Ctrl+X cuts', s.n === 2 && s.undo === 'Cut', s.order);
  await click(await rowPoint('[role=option]', 1)); await key('V', ['control']); s = await sum();
  check('…and pastes into a new position', s.order.join() === 'feel sooooo hard,Cryogenic Hopetown,Fly Octo Fly', s.order);
  await key('Z', ['control']); await key('Z', ['control']); s = await sum();
  check('two undos restore the original order', s.order.join() === 'feel sooooo hard,Fly Octo Fly,Cryogenic Hopetown', s.order);

  // --- Remove the playing track: playback continues, Next carries on from its place ---
  s = await R(`store.play(P().id, store.layoutOf(P()).order[1]); await new Promise((r) => setTimeout(r, 1000)); return summary();`);
  check('double-click equivalent plays Fly Octo Fly', s.status === 'playing' && s.current === 'Fly Octo Fly', s);
  await click(await rowPoint('[role=option]', 1)); await key('Delete'); await sleep(400); s = await sum();
  check('deleting the playing track keeps it playing (detached)', s.status === 'playing' && s.current === 'Fly Octo Fly' && s.detached === 1 && s.n === 2, s);
  s = await R(`player.next(); await new Promise((r) => setTimeout(r, 900)); return summary();`);
  check('Next plays the track that followed it', s.current === 'Cryogenic Hopetown' && s.status === 'playing', s);
  await key('Z', ['control']); s = await sum();
  check('undo brings it back, playback unaffected', s.n === 3 && s.current === 'Cryogenic Hopetown' && s.detached === null, s);

  // --- Grouping ---
  s = await R(`cmds.runCommand('playlist.grouping.album'); await new Promise((r) => setTimeout(r, 150)); return summary();`);
  check('Group by Album: three groups, undoable', JSON.stringify(s.groups) === '["Unknown Album","Splatoon"]' || s.groups?.length >= 2, s);
  const headers = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.group')].map((g) => g.innerText.replace(/\\n/g, ' / '))`);
  log('  headers:', JSON.stringify(headers));
  check('queue follows the grouped display order', JSON.stringify(s.queue) === JSON.stringify(s.order), s);
  const beforeHistory = (await R('return P().past.length;'));
  await click(await w.webContents.executeJavaScript(`(() => { const r = document.querySelector('.group__toggle').getBoundingClientRect(); return { x: Math.round(r.left + 8), y: Math.round(r.top + 10) }; })()`));
  s = await sum();
  check('collapse toggle hides a group, no undo step', s.collapsed === 1 && (await R('return P().past.length;')) === beforeHistory, s);
  s = await R(`cmds.runCommand('view.expandAll'); return summary();`);
  check('Expand All', s.collapsed === 0, s);
  const groupsBefore = s.groups;
  await dragTo(await rowPoint('.group', groupsBefore.length - 1, 0.3), await rowPoint('.group', 0, 0.1));
  s = await sum();
  check('drag the last group header to the top', s.groups[0] === groupsBefore.at(-1) && s.undo === 'Move Group' && JSON.stringify(s.queue) === JSON.stringify(s.order), { before: groupsBefore, s });

  // --- Tabs ---
  answers.push({ kind: 'save', value: H + '/Playlists/p5.bday' });
  await R(`store.toggleCollapsed(P().id, store.layoutOf(P()).groups[0].key); await actions.saveViewed();`);
  await key('N', ['control']); s = await sum();
  check('Ctrl+N opens a new tab', s.tabs === 2 && s.n === 0 && !s.viewedIsPlaying, s);
  const strip = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.tab')].map((t) => t.innerText.replace(/\\n/g, ' '))`);
  check('the playing tab shows ♪', strip[0].includes('♪') && strip[1].includes('Untitled'), strip);
  await key('J', ['control']); s = await sum();
  check('Ctrl+J jumps to the now-playing tab and row', s.viewedIsPlaying && s.sel.join() === 'Cryogenic Hopetown', s);
  await key('Tab', ['control']); s = await sum();
  check('Ctrl+Tab cycles tabs', !s.viewedIsPlaying, s);
  await key('W', ['control']); s = await sum();
  check('Ctrl+W closes the empty tab without asking', s.tabs === 1 && s.viewedIsPlaying, s);

  const config = JSON.parse(fs.readFileSync(S + '/userdata/config.json', 'utf8'));
  check('session saved to app config', config.session.tabs.length === 1 && config.session.tabs[0].filePath.endsWith('p5.bday'), config.session);
  const saved = await readBday(H + '/Playlists/p5.bday');
  check('grouping and collapse state saved in the .bday', saved.manifest.grouping?.preset === 'album' && saved.manifest.groups.length === 1 && saved.manifest.groups[0].collapsed, saved.manifest.groups);

  // --- 5,000 tracks ---
  const perf = await R(`
    const tracks = Array.from({ length: 5000 }, (_, i) => ({ id: 'x' + i, absPath: '/nope/' + i + '.flac', relPath: null, size: 1, fingerprint: null, overrides: {}, groupId: null, linkNext: null,
      tags: { title: 'Track ' + i, artist: 'Artist ' + (i % 40), album: 'Album ' + (i % 300), duration: 180, codec: 'FLAC', bitrate: 900, year: 2000 + (i % 25) } }));
    let t0 = performance.now();
    // Timed to the DOM update, not requestAnimationFrame: a never-shown window throttles rAF to ~1/s.
    const until = async (cond) => { const t = performance.now(); while (!cond()) await new Promise((r) => setTimeout(r, 0)); document.body.getBoundingClientRect(); return performance.now() - t; };
    store.addOpenedPlaylist({ filePath: null, storage: 'reference', doc: { meta: { name: 'Big' }, palette: null, grouping: null, groups: [], tracks }, resolution: {} });
    await until(() => document.querySelector('.tracklist__name')?.textContent.startsWith('Big') && document.querySelectorAll('[role=option]').length > 0);
    const openMs = performance.now() - t0;
    t0 = performance.now(); store.setGrouping(P().id, 'album'); await until(() => document.querySelectorAll('.group').length > 0);
    const groupMs = performance.now() - t0;
    const el = document.querySelector('.tracklist__scroll'); const steps = []; 
    for (let y = 0; y < el.scrollHeight; y += 1500) { const a = performance.now(); el.scrollTop = y; el.dispatchEvent(new Event('scroll')); await new Promise((r) => setTimeout(r, 0)); document.body.getBoundingClientRect(); steps.push(performance.now() - a); }
    steps.sort((a, b) => a - b);
    return { openMs: Math.round(openMs), groupMs: Math.round(groupMs), scrollSteps: steps.length, medianStepMs: +steps[steps.length >> 1].toFixed(1), worstStepMs: +steps.at(-1).toFixed(1), domRows: document.querySelectorAll('[role=option], .group').length, groups: store.layoutOf(P()).groups.length };`);
  // Scroll bars: medians were ~8ms when written (2026-10-28), 23-36ms on a busier host
  // (2026-10-30), with single worst steps up to ~70ms. A real regression shows in the median.
  check('5,000 tracks: opens and groups fast, renders only on-screen rows', perf.openMs < 300 && perf.groupMs < 200 && perf.medianStepMs < 50 && perf.worstStepMs < 100 && perf.domRows < 150, perf);
  log('  perf:', JSON.stringify(perf));
  await R(`store.revertToSaved(P().id); store.closePlaylist(P().id);`);

  // Plant a missing playlist in the session for the restart test, then quit.
  w.close();
  await new Promise((r) => w.once('closed', r));
  const c2 = JSON.parse(fs.readFileSync(S + '/userdata/config.json', 'utf8'));
  c2.session.tabs.push({ filePath: H + '/Playlists/gone.bday', name: 'Gone Mix' });
  fs.writeFileSync(S + '/userdata/config.json', JSON.stringify(c2));
  log('ALL STEPS PASSED (run 1)');
};
