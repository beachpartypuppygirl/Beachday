// Phase 6: the art pane — draggable split, show/hide, the art resolution chain, custom art
// (stored in the .bday and unpacked on another machine), the GIF guardrail, pausing GIFs.
import fs from 'node:fs';
import path from 'node:path';
import { makeGif } from '../gif-fixture.mjs';
const { readBday, writeBday } = await import(new URL('../../src/main/bday.mjs', import.meta.url));
const { inspectGif, GIF_DECODED_BUDGET } = await import(new URL('../../src/main/gif.mjs', import.meta.url));

const PRE = `(async () => {
  const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
  const store = await mod('/src/renderer/store/playlists.js'); const actions = await mod('/src/renderer/store/actions.js');
  const ui = await mod('/src/renderer/store/ui.js'); const { symbolUrl } = await mod('/src/renderer/symbols.js'); const { symbolSeed } = await mod('/src/renderer/store/art.js'); const cmds = await mod('/src/renderer/menus/commands.js'); const { player } = await mod('/src/renderer/audio/engine.js');
  const P = () => { const s = store.getState(); return s.playlists[s.viewedId]; };
  const byTitle = (title) => P().doc.tracks.find((t) => t.tags.title === title);
  const pane = () => { const el = document.querySelector('.pane--art'); if (!el) return null; const img = el.querySelector('img.art:not(.art--generated)'); const gif = el.querySelector('canvas[data-gif]'); const symbol = el.querySelector('img.art--generated');
    return { width: Math.round(el.getBoundingClientRect().width), img: img?.getAttribute('src') ?? gif?.dataset.src ?? null, generated: Boolean(symbol), symbol: symbol?.getAttribute('src') ?? null,
      gif: gif?.dataset.gif ?? null, frame: gif?.dataset.frame == null ? null : Number(gif.dataset.frame), text: el.innerText.trim() }; };
  // Frames shown over a stretch of time: a playing GIF moves on, a paused one doesn't.
  const frames = async (ms = 400) => { const seen = new Set(); const t = performance.now(); while (performance.now() - t < ms) { seen.add(pane().frame); await new Promise((r) => setTimeout(r, 15)); } return [...seen]; };
  const focus = (on) => { document.hasFocus = () => on; window.dispatchEvent(new Event(on ? 'focus' : 'blur')); };
  const until = async (cond, ms = 3000) => { const t = performance.now(); while (!(await cond()) && performance.now() - t < ms) await new Promise((r) => setTimeout(r, 20)); };
`;

export default async ({ w, answers, log, S }) => {
  const H = S + '/home', M = H + '/Music';
  const flac = M + '/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', mp3 = M + '/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', wav = M + '/Breakcore/feel sooooo hard (renamed).wav';
  const R = (code) => w.webContents.executeJavaScript(PRE + code + '\n})()');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, cond, detail) => { if (!cond) throw new Error(`${name}\n    ${JSON.stringify(detail)}`); log('PASS', name); };
  const send = (e) => w.webContents.sendInputEvent(e);
  const config = () => JSON.parse(fs.readFileSync(S + '/userdata/config.json', 'utf8'));
  const cacheDir = S + '/userdata/art-cache';
  const cached = (url) => path.join(cacheDir, url.split('/').pop());
  let s;

  // A GIF over the decoded-memory budget: 1200×1000, 60 frames ≈ 288MB decoded.
  const bigGif = H + '/Downloads/big.gif';
  fs.writeFileSync(bigGif, makeGif(1200, 1000, 60, { delay: 40 }));
  check('fixture GIF is over the budget', inspectGif(fs.readFileSync(bigGif)).decodedBytes > GIF_DECODED_BUDGET, inspectGif(fs.readFileSync(bigGif)));

  answers.push({ kind: 'open', value: [flac, mp3, wav] });
  await R('await actions.addFiles();');

  // --- The split ---
  s = await R('return pane();');
  check('art pane starts at 55% of the width', Math.abs(s.width - 1400 * 0.55) < 3, s);
  check('nothing playing: a quiet empty state', /nothing playing/i.test(s.text), s);
  const splitter = await w.webContents.executeJavaScript(`(() => { const r = document.querySelector('.splitter').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + r.height / 2) }; })()`);
  const drag = async (toX) => {
    send({ type: 'mouseDown', ...splitter, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) { send({ type: 'mouseMove', x: Math.round(splitter.x + ((toX - splitter.x) * i) / 6), y: splitter.y, button: 'left' }); await sleep(30); }
    send({ type: 'mouseUp', x: toX, y: splitter.y, button: 'left', clickCount: 1 }); await sleep(250);
  };
  await drag(900);
  s = await R('return { pane: pane(), fraction: ui.getState().artPane.fraction };');
  check('dragging the divider resizes the art pane', Math.abs(s.pane.width - 900) < 3, s);
  check('…and the size is saved to app config', Math.abs(config().artPane.fraction - 900 / 1400) < 0.01, config().artPane);
  splitter.x = 900;
  await drag(5);
  s = await R('return pane();');
  check('the art pane can’t be dragged below its minimum', s.width === 240, s);
  splitter.x = 240;
  await drag(1395);
  s = await R('return pane();');
  check('nor can the list', s.width === 1400 - 420, s);
  s = await R(`cmds.runCommand('view.resetArtPane'); await new Promise((r) => setTimeout(r, 100)); return { pane: pane(), enabled: cmds.resolveItem('view.resetArtPane', cmds.getContext()).enabled };`);
  check('View ▸ Reset Art Pane Size returns to 55%, then greys out', Math.abs(s.pane.width - 770) < 3 && !s.enabled, s);
  s = await R(`cmds.runCommand('view.showArtPane'); await new Promise((r) => setTimeout(r, 100)); return { pane: pane(), list: Math.round(document.querySelector('.pane--list').getBoundingClientRect().width) };`);
  check('View ▸ Show Art Pane hides it; the list takes the width', s.pane === null && s.list === 1400 && config().artPane.visible === false, s);
  await R(`cmds.runCommand('view.showArtPane');`);

  // --- The art chain in the pane ---
  s = await R(`store.play(P().id, byTitle('Fly Octo Fly').id); await until(() => pane().img); return pane();`);
  check('a track with embedded art shows it', s.img?.startsWith('beachday-media://art/') && !s.generated, s);
  s = await R(`store.play(P().id, byTitle('feel sooooo hard').id); await until(() => pane().generated); const t = byTitle('feel sooooo hard');
    return { pane: pane(), fingerprint: t.fingerprint, expected: symbolUrl(symbolSeed(t)) };`);
  check('a track with no art at all ends at its generated symbol, seeded by its fingerprint',
    s.pane.generated && !s.pane.img && s.fingerprint && s.pane.symbol === s.expected && s.pane.symbol.startsWith('data:image/svg+xml'), { ...s, expected: s.expected?.slice(0, 40), pane: { ...s.pane, symbol: s.pane.symbol?.slice(0, 40) } });
  s = await R(`await until(() => navigator.mediaSession.metadata?.artwork?.[0]?.src.startsWith('blob:'));
    const blob = await (await fetch(navigator.mediaSession.metadata.artwork[0].src)).blob(); const bitmap = await createImageBitmap(blob);
    return { type: blob.type, size: [bitmap.width, bitmap.height] };`);
  check('…and the media overlay gets the symbol as a 512px PNG', s.type === 'image/png' && s.size[0] === 512 && s.size[1] === 512, s);

  // --- Custom art: an over-budget GIF, through the guardrail ---
  answers.push({ kind: 'open', value: [bigGif] });
  const t0 = Date.now();
  s = await R(`await actions.setCustomArt(P().id, [byTitle('feel sooooo hard').id]); focus(true);
    await until(() => pane().frame != null); return { pane: pane(), ref: byTitle('feel sooooo hard').overrides.art, undo: P().past.at(-1).label, dirty: store.isDirty(P()) };`);
  log(`  guardrail took ${Date.now() - t0}ms`);
  check('Set Custom Art… sets it, undoably, and the pane shows it', s.ref?.startsWith('art/') && s.ref.endsWith('.gif') && s.undo === 'Set Custom Art' && s.dirty && s.pane.img?.endsWith('.gif'), s);
  const guarded = inspectGif(fs.readFileSync(cached(s.pane.img)));
  check('the cached GIF was downscaled under the budget, every frame kept', guarded.decodedBytes <= GIF_DECODED_BUDGET && guarded.frames === 60 && guarded.width < 1200, guarded);
  const customUrl = s.pane.img;

  // --- Pausing GIFs (played frame by frame, so a pause holds its frame) ---
  s = await R(`return { pane: pane(), frames: await frames() };`);
  check('the GIF animates while the music plays', s.pane.gif === 'playing' && s.frames.length > 3, s);
  s = await R(`focus(false); await new Promise((r) => setTimeout(r, 60)); return { pane: pane(), frames: await frames() };`);
  check('window loses focus: the GIF holds still', s.pane.gif === 'paused' && s.frames.length === 1, s);
  s = await R(`focus(true); return { frames: await frames() };`);
  check('focus returns: it animates again', s.frames.length > 3, s);
  s = await R(`player.togglePlay(); await until(() => pane().gif === 'paused'); await new Promise((r) => setTimeout(r, 60));
    const held = pane().frame; const still = await frames();
    player.togglePlay(); await until(() => pane().gif === 'playing'); await new Promise((r) => setTimeout(r, 15));
    return { status: player.getState().status, held, still, resumedAt: pane().frame };`);
  check('pausing the music pauses the GIF on its frame (default on)', s.still.length === 1 && s.still[0] === s.held, s);
  check('…and playing resumes from that frame, not the start', s.status === 'playing' && [s.held, (s.held + 1) % 60].includes(s.resumedAt), s);
  s = await R(`cmds.runCommand('options.pauseGifsWithPlayback'); player.togglePlay(); await new Promise((r) => setTimeout(r, 100));
    const out = { status: player.getState().status, pane: pane(), frames: await frames() }; player.togglePlay(); return out;`);
  check('Options ▸ Pause GIFs When Playback Pauses off: animates through a pause', s.status === 'paused' && s.pane.gif === 'playing' && s.frames.length > 3 && config().pauseGifsWithPlayback === false, s);
  await R(`cmds.runCommand('options.pauseGifsWithPlayback');`);
  s = await R(`cmds.runCommand('options.pauseGifs'); focus(false); await new Promise((r) => setTimeout(r, 60)); return { pane: pane(), frames: await frames() };`);
  check('Options ▸ Pause GIFs When Window Is Unfocused off: keeps animating', s.pane.gif === 'playing' && s.frames.length > 3 && config().pauseGifs === false, s);
  await R(`cmds.runCommand('options.pauseGifs'); focus(true);`);

  // --- Right-click on the art pane: art for the playing track ---
  const rightClick = async (p) => { send({ type: 'mouseDown', ...p, button: 'right', clickCount: 1 }); send({ type: 'mouseUp', ...p, button: 'right', clickCount: 1 }); await sleep(200); };
  const menuItem = (label) => w.webContents.executeJavaScript(`(() => { const el = [...document.querySelectorAll('.contextmenu [role=menuitem]')].find((e) => e.textContent.includes(${JSON.stringify(label)})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2), disabled: el.getAttribute('aria-disabled') === 'true' }; })()`);
  await R(`store.setSelection(P().id, [byTitle('Fly Octo Fly').id]);`); // the selection is elsewhere: the menu must act on the playing track
  await rightClick({ x: 300, y: 400 });
  const labels = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.contextmenu [role=menuitem]')].map((e) => e.textContent)`);
  check('right-clicking the art opens the art menu', labels.some((l) => l.includes('Set Custom Art')) && labels.some((l) => l.includes('Clear Custom Art')), labels);
  s = await R(`return player.getState().status;`);
  check('…without toggling playback', s === 'playing', s);
  const clearItem = await menuItem('Clear Custom Art');
  send({ type: 'mouseDown', x: clearItem.x, y: clearItem.y, button: 'left', clickCount: 1 }); send({ type: 'mouseUp', x: clearItem.x, y: clearItem.y, button: 'left', clickCount: 1 }); await sleep(250);
  s = await R(`return { art: byTitle('feel sooooo hard').overrides.art ?? null, other: byTitle('Fly Octo Fly').overrides.art ?? null, undo: P().past.at(-1).label, menu: Boolean(document.querySelector('.contextmenu')), pane: pane(), status: player.getState().status };`);
  check('Clear Custom Art there clears the playing track’s art (not the selection’s)', s.art === null && s.other === null && s.undo === 'Clear Custom Art' && !s.menu && s.pane.generated && s.status === 'playing', s);
  answers.push({ kind: 'open', value: [bigGif] });
  await rightClick({ x: 300, y: 400 });
  const setItem = await menuItem('Set Custom Art');
  send({ type: 'mouseDown', x: setItem.x, y: setItem.y, button: 'left', clickCount: 1 }); send({ type: 'mouseUp', x: setItem.x, y: setItem.y, button: 'left', clickCount: 1 });
  s = await R(`await until(() => pane().img); return { art: byTitle('feel sooooo hard').overrides.art ?? null, pane: pane() };`);
  check('Set Custom Art… there sets it on the playing track', s.art?.endsWith('.gif') && s.pane.img === customUrl, s);

  // --- Group headers use the same chain ---
  s = await R(`cmds.runCommand('playlist.grouping.album'); await new Promise((r) => setTimeout(r, 200));
    const g = store.layoutOf(P()).groupOf.get(byTitle('feel sooooo hard').id);
    return { groupArt: g.artUrl, headerImgs: [...document.querySelectorAll('.group .group__art')].map((i) => i.getAttribute('src') ?? i.dataset.src) };`);
  check('a group header picks up custom art from its first track', s.groupArt === customUrl && s.headerImgs.includes(customUrl), s);

  // --- Saved inside the .bday ---
  answers.push({ kind: 'save', value: H + '/Playlists/p6.bday' });
  await R('await actions.saveViewed();');
  let saved = await readBday(H + '/Playlists/p6.bday');
  const savedRef = saved.manifest.tracks.find((t) => t.tags.title === 'feel sooooo hard').overrides.art;
  check('the custom art is stored in the .bday’s art/', savedRef && saved.art.has(savedRef) && inspectGif(saved.art.get(savedRef)).decodedBytes <= GIF_DECODED_BUDGET, { savedRef, art: [...saved.art.keys()] });

  // --- "Another machine": no art cache at all, then reopen ---
  await R(`player.stop(); store.closePlaylist(P().id);`);
  fs.rmSync(cacheDir, { recursive: true, force: true });
  answers.push({ kind: 'open', value: [H + '/Playlists/p6.bday'] });
  s = await R(`await actions.openPlaylist(); const t = byTitle('feel sooooo hard'); const g = store.layoutOf(P()).groupOf.get(t.id);
    const res = await fetch(store.trackView(t, P().resolution).artUrl); return { ref: t.overrides.art, status: res.status, type: res.headers.get('content-type'), groupArt: g.artUrl, dirty: store.isDirty(P()) };`);
  check('reopened with an empty art cache: custom art unpacked from the .bday', s.ref && s.status === 200 && s.type === 'image/gif' && !s.dirty, s);
  check('embedded art is re-extracted from the audio as before', fs.readdirSync(cacheDir).some((f) => !f.endsWith('.gif')), fs.readdirSync(cacheDir));

  // --- Clear Custom Art ---
  s = await R(`store.setSelection(P().id, [byTitle('feel sooooo hard').id]); cmds.runCommand('track.clearArt'); await new Promise((r) => setTimeout(r, 100));
    return { art: byTitle('feel sooooo hard').overrides.art ?? null, undo: P().past.at(-1).label, enabled: cmds.resolveItem('track.clearArt', cmds.getContext()).enabled };`);
  check('Clear Custom Art removes it (undoable), then greys out', s.art === null && s.undo === 'Clear Custom Art' && !s.enabled, s);
  s = await R(`const g = store.layoutOf(P()).groupOf.get(byTitle('feel sooooo hard').id); await new Promise((r) => setTimeout(r, 100));
    const header = [...document.querySelectorAll('.group')].find((el) => el.textContent.includes(g.mainName));
    return { artUrl: g.artUrl, seed: g.symbolSeed === symbolSeed(P().doc.tracks.find((t) => t.id === g.trackIds[0])), src: header?.querySelector('img.group__art--generated')?.getAttribute('src') === symbolUrl(g.symbolSeed) };`);
  check('a group with no art at all shows its first track’s symbol in the header', s.artUrl === null && s.seed && s.src, s);
  s = await R(`store.undo(P().id); return byTitle('feel sooooo hard').overrides.art ?? null;`);
  check('undo restores it', s?.endsWith('.gif'), s);

  // --- A hand-made .bday: an over-budget GIF as its cover, a bogus art reference, deflated art ---
  const hostile = H + '/Downloads/inbox/handmade.bday';
  fs.copyFileSync(bigGif, S + '/out/cover.gif');
  await writeBday(hostile, {
    formatVersion: 1, bundled: false,
    meta: { name: 'Handmade', cover: 'art/cover.gif' },
    groups: [{ key: 'nope', art: '../../../etc/passwd' }],
    tracks: [{ id: 'h1', absPath: wav, relPath: null, tags: { title: 'Handmade WAV', duration: 10 }, overrides: { art: 'art/not-there.png' } }],
  }, [], undefined, [{ name: 'art/cover.gif', path: S + '/out/cover.gif' }]);
  answers.push({ kind: 'open', value: [hostile] });
  s = await R(`await actions.openPlaylist(); store.play(P().id, 'h1'); await until(() => pane().img);
    return { cover: P().doc.meta.cover, trackArt: P().doc.tracks[0].overrides.art ?? null, groupArt: P().doc.groups[0].art, pane: pane() };`);
  check('a .bday’s own cover is guarded on the way in and fills the pane', /^art\/[0-9a-f]{32}\.gif$/.test(s.cover) && s.pane.img?.endsWith(s.cover.slice(4)), s);
  check('bad art references are dropped, not followed', s.trackArt === null && s.groupArt === null, s);
  check('the cover GIF in the cache is under budget', inspectGif(fs.readFileSync(path.join(cacheDir, s.cover.slice(4)))).decodedBytes <= GIF_DECODED_BUDGET);

  // Quit without saving.
  await R(`for (const id of store.getState().order) store.revertToSaved(id);`);
  w.close();
  await new Promise((r) => w.once('closed', r));
  log('ALL STEPS PASSED');
};
