// Phase 8: shuffle (permutation cursor), repeat modes, Stop After Current, link chains (Link /
// Unlink, contiguity, healing, drag as one, never dropped into), chains in shuffle and playback.
const { readBday } = await import(new URL('../../src/main/bday.mjs', import.meta.url));

const PRE = `(async () => {
  const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
  const store = await mod('/src/renderer/store/playlists.js'); const actions = await mod('/src/renderer/store/actions.js');
  const ui = await mod('/src/renderer/store/ui.js'); const cmds = await mod('/src/renderer/menus/commands.js'); const { player } = await mod('/src/renderer/audio/engine.js');
  const P = () => { const s = store.getState(); return s.playlists[s.viewedId]; };
  const byTitle = (title) => P().doc.tracks.find((t) => t.tags.title === title);
  const title = (id) => P().doc.tracks.find((t) => t.id === id)?.tags.title;
  const until = async (cond, ms = 4000) => { const t = performance.now(); while (!(await cond()) && performance.now() - t < ms) await new Promise((r) => setTimeout(r, 20)); };
  const order = () => store.layoutOf(P()).order.map(title);
  const links = () => P().doc.tracks.filter((t) => t.linkNext).map((t) => title(t.id) + '>' + title(t.linkNext));
  const rails = () => [...document.querySelectorAll('.track')].map((e) => (e.classList.contains('track--link-up') ? '^' : '') + e.querySelector('.track__title').textContent + (e.classList.contains('track--link-down') ? 'v' : ''));
  const select = (...titles) => { const ids = titles.map((t) => byTitle(t).id); store.setSelection(P().id, ids, { anchorId: ids[0], focusId: ids.at(-1) }); document.querySelector('.tracklist__scroll').focus(); };
  const playing = () => title(player.getState().current?.id);
  // Play the current track out: jump to just before its end and wait for what happens next.
  const finish = async () => { const before = player.getState().current?.id; await until(() => player.getState().duration > 0);
    player.seek(player.getState().duration - 0.25); await until(() => player.getState().current?.id !== before || player.getState().status !== 'playing' || player.getPosition() < 1, 5000);
    await new Promise((r) => setTimeout(r, 150)); return { playing: playing(), status: player.getState().status, position: player.getPosition() }; };
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
  const click = async (p) => { send({ type: 'mouseMove', ...p }); send({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 }); send({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); await sleep(200); };
  const box = (selector, text = '') => w.webContents.executeJavaScript(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 60), top: Math.round(r.top), bottom: Math.round(r.bottom), y: Math.round(r.top + r.height / 2) }; })()`);
  const centreOf = (selector) => w.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const drag = async (from, to) => {
    send({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) { send({ type: 'mouseMove', x: from.x, y: Math.round(from.y + ((to.y - from.y) * i) / 6), button: 'left' }); await sleep(40); }
    send({ type: 'mouseUp', x: from.x, y: to.y, button: 'left', clickCount: 1 }); await sleep(250);
  };
  let s;

  answers.push({ kind: 'open', value: [flac, mp3, wav] });
  await R(`await actions.addFiles(); player.setOrder('sequential'); player.setRepeat('off');
    store.moveTracksTo(P().id, [byTitle('${F}').id, byTitle('${Mp}').id, byTitle('${Wv}').id], {});`);
  s = await R('return order();');
  check('three tracks, in import order', JSON.stringify(s) === JSON.stringify([F, Mp, Wv]), s);

  // --- Link: contiguous by construction ---
  await R(`select('${F}', '${Wv}');`);
  await key('L', ['control']);
  s = await R(`return { order: order(), links: links(), rails: rails(), undo: cmds.resolveItem('edit.undo', cmds.getContext()).label };`);
  check('Ctrl+L links two tracks that weren’t neighbours: the second moves up to follow the first', JSON.stringify(s.order) === JSON.stringify([F, Wv, Mp]) && JSON.stringify(s.links) === JSON.stringify([`${F}>${Wv}`]), s);
  check('…drawn as a rail joining the rows; one undo step', s.rails[0] === `${F}v` && s.rails[1] === `^${Wv}` && s.rails[2] === Mp && s.undo === 'Undo Link Tracks', s);
  await R(`select('${Wv}', '${Mp}');`);
  await key('L', ['control']);
  s = await R(`return { links: links(), rails: rails() };`);
  check('linking a chain’s track to another absorbs the whole chain', JSON.stringify(s.links) === JSON.stringify([`${F}>${Wv}`, `${Wv}>${Mp}`]) && s.rails[1] === `^${Wv}v`, s);

  // --- Remove heals; Unlink cuts; paste keeps links ---
  s = await R(`select('${Wv}'); actions.removeSelection(); const after = links(); actions.undo(); return { after, back: links() };`);
  check('removing the middle of a chain closes it up', JSON.stringify(s.after) === JSON.stringify([`${F}>${Mp}`]) && s.back.length === 2, s);
  await R(`select('${Wv}');`);
  await key('L', ['control', 'shift']);
  s = await R(`return { links: links(), order: order() };`);
  check('Ctrl+Shift+L: the selected track leaves its chain', s.links.length === 0 && JSON.stringify(s.order) === JSON.stringify([F, Wv, Mp]), s);
  await R(`actions.undo();`);
  s = await R(`select('${F}', '${Wv}', '${Mp}'); actions.copySelection(); select('${Mp}'); actions.paste(); await new Promise((r) => setTimeout(r, 50));
    const pasted = P().doc.tracks.slice(3); const ok = pasted[0].linkNext === pasted[1].id && pasted[1].linkNext === pasted[2].id && !pasted[2].linkNext;
    const total = P().doc.tracks.length; actions.undo(); return { ok, total, links: links() };`);
  check('a copied chain pastes as a chain (new ids, links between them kept)', s.ok && s.total === 6 && s.links.length === 2, s);

  // --- Dragging: chains move as one, and nothing lands inside one ---
  await R(`player.stop(); store.setGrouping(P().id, null); select('${Wv}');`);
  // Unlink the WAV→MP3 link so the MP3 stands alone outside a two-track chain (F→Wv).
  await R(`store.unlinkTracks(P().id, [byTitle('${Mp}').id]);`);
  s = await R(`return { links: links(), order: order() };`);
  check('setup: a two-track chain and a single track', JSON.stringify(s.links) === JSON.stringify([`${F}>${Wv}`]) && JSON.stringify(s.order) === JSON.stringify([F, Wv, Mp]), s);
  const single = await box('.track', Mp);
  const tail = await box('.track', Wv);
  await R(`select('${Mp}');`);
  await drag(single, { y: tail.top + 3 });
  s = await R(`return { order: order(), links: links() };`);
  check('dropping a track into the middle of a chain puts it before the chain instead', JSON.stringify(s.order) === JSON.stringify([Mp, F, Wv]) && s.links.length === 1, s);
  const head = await box('.track', F);
  const top = await box('.track', Mp);
  await R(`select('${Wv}');`);
  await drag(await box('.track', Wv), { y: top.top + 3 });
  s = await R(`return { order: order(), links: links() };`);
  check('dragging a chain’s last track drags the whole chain', JSON.stringify(s.order) === JSON.stringify([F, Wv, Mp]) && s.links.length === 1, { s, head });

  // --- Playback through chains ---
  s = await R(`store.play(P().id, byTitle('${F}').id); await until(() => player.getState().status === 'playing'); return await finish();`);
  check('sequential: the chain plays through', s.playing === Wv && s.status === 'playing', s);

  // --- Shuffle ---
  s = await R(`player.setOrder('shuffle'); const sh = player.getShuffle(); return { order: player.getState().order, ids: sh.ids.map(title), pos: sh.pos, playing: playing(), stored: localStorage.getItem('beachday.order') };`);
  check('turning shuffle on mid-song keeps the song, as the start of the shuffle (its chain with it)', s.order === 'shuffle' && s.ids[0] === F && s.ids[1] === Wv && s.ids[s.pos] === Wv && s.stored === 'shuffle', s);
  s = await R(`const seen = new Set(); for (let i = 0; i < 40; i++) { player.reshuffle(); const ids = player.getShuffle().ids.map(title); seen.add(ids.join(',')); if (ids.indexOf('${Wv}') !== ids.indexOf('${F}') + 1) return { broken: ids }; } return { seen: [...seen] };`);
  check('every reshuffle keeps the chain together, in order, with the playing chain first', !s.broken && JSON.stringify(s.seen) === JSON.stringify([[F, Wv, Mp].join(',')]), s);
  // Pick the chain's second track: it plays, then the chain is done, then the rest of the shuffle.
  s = await R(`player.stop(); store.play(P().id, byTitle('${Wv}').id); await until(() => playing() === '${Wv}' && player.getState().status === 'playing'); const sh = player.getShuffle();
    return { at: sh.ids.map(title).slice(Math.floor(sh.pos)), next: await finish() };`);
  check('picking a track while shuffling plays it now; the shuffle carries on after it', s.at[0] === Wv && s.next.playing === s.at[1], s);
  s = await R(`player.previous(); await until(() => playing() === '${Wv}'); return { playing: playing() };`);
  check('Previous walks back through what actually played', s.playing === Wv, s);

  // --- Repeat ---
  s = await R(`player.setOrder('sequential'); player.setRepeat('one'); store.play(P().id, byTitle('${F}').id); await until(() => playing() === '${F}'); return await finish();`);
  check('Repeat One: the track starts again when it ends', s.playing === F && s.status === 'playing' && s.position < 2, s);
  s = await R(`player.next(); await until(() => playing() !== '${F}'); return playing();`);
  check('…but Next still moves on', s === Wv, s);
  s = await R(`player.setRepeat('all'); store.play(P().id, byTitle('${Mp}').id); await until(() => playing() === '${Mp}'); return await finish();`);
  check('Repeat All: after the last track, back to the first', s.playing === F && s.status === 'playing', s);
  s = await R(`player.setRepeat('off'); store.play(P().id, byTitle('${Mp}').id); await until(() => playing() === '${Mp}'); return await finish();`);
  check('Repeat Off: the end of the playlist stops', s.status === 'stopped' && s.playing === Mp, s);

  // --- Stop After Current ---
  s = await R(`store.play(P().id, byTitle('${F}').id); await until(() => playing() === '${F}'); cmds.runCommand('playback.stopAfterCurrent');
    const checked = cmds.resolveItem('playback.stopAfterCurrent', cmds.getContext()).checked; const after = await finish();
    return { checked, after, flag: player.getState().stopAfterCurrent };`);
  check('Stop After Current stops when the track ends, with the next one waiting, and switches itself off', s.checked && s.after.status === 'stopped' && s.after.playing === Wv && !s.flag, s);
  s = await R(`cmds.runCommand('playback.playPause'); await until(() => player.getState().status === 'playing'); return { playing: playing(), position: player.getPosition() };`);
  check('…then Play carries on from there', s.playing === Wv && s.position < 2, s);

  // --- The transport toggles (real clicks) ---
  await R(`player.setOrder('sequential'); player.setRepeat('off');`);
  await click(await centreOf('.transport__mode[aria-label^="Shuffle"]'));
  s = await R(`const b = document.querySelector('.transport__mode[aria-label^="Shuffle"]'); return { order: player.getState().order, pressed: b.getAttribute('aria-pressed'), label: b.title };`);
  check('the shuffle button turns shuffle on, and shows it', s.order === 'shuffle' && s.pressed === 'true' && s.label === 'Shuffle: on', s);
  const repeatButton = await centreOf('.transport__mode[aria-label^="Repeat"]');
  const repeats = [];
  for (let i = 0; i < 3; i++) {
    await click(repeatButton);
    repeats.push(await R(`const b = document.querySelector('.transport__mode[aria-label^="Repeat"]'); return [player.getState().repeat, b.getAttribute('aria-pressed'), b.querySelector('.transport__mode-badge')?.textContent ?? ''];`));
  }
  check('the repeat button cycles Off → All → One (marked 1) → Off', JSON.stringify(repeats) === JSON.stringify([['all', 'true', ''], ['one', 'true', '1'], ['off', 'false', '']]), repeats);
  s = await R(`return cmds.MENUS.find((m) => m.label === 'Playback').items.map((i) => typeof i === 'string' ? cmds.resolveItem(i, cmds.getContext()).label : i.label);`);
  check('Playback menu: Order, Repeat, Reshuffle, Stop After Current', ['Order', 'Repeat', 'Reshuffle', 'Stop After Current'].every((l) => s.includes(l)), s);

  // --- Grouped: linking across groups ---
  s = await R(`player.stop(); store.setGrouping(P().id, 'album'); const g = (t) => store.layoutOf(P()).groupOf.get(byTitle(t).id).key;
    const before = [g('${F}'), g('${Mp}')]; select('${Mp}', '${F}'); cmds.runCommand('track.link'); await new Promise((r) => setTimeout(r, 50));
    return { before, after: [g('${F}'), g('${Mp}')], linked: [...store.layoutOf(P()).linked].map(title), rails: rails() };`);
  check('grouped: linking tracks from two groups brings them into the first one’s group, linked', s.before[0] !== s.before[1] && s.after[0] === s.after[1] && s.linked.length === 2, s);

  // --- Saved and reopened ---
  answers.push({ kind: 'save', value: H + '/Playlists/p8.bday' });
  await R('await actions.saveViewed();');
  const { manifest } = await readBday(H + '/Playlists/p8.bday');
  const t = (title) => manifest.tracks.find((x) => x.tags.title === title);
  const ids = new Set(manifest.tracks.map((x) => x.id));
  check('links travel in the .bday (a three-track chain)', manifest.tracks.filter((x) => ids.has(x.linkNext)).length === 2 && t(F).linkNext, manifest.tracks.map((x) => [x.tags.title, x.linkNext]));
  await R(`await actions.closeViewed();`);
  answers.push({ kind: 'open', value: [H + '/Playlists/p8.bday'] });
  await R('await actions.openPlaylist();');
  s = await R(`return { linked: [...store.layoutOf(P()).linked].map(title).sort(), rails: rails() };`);
  check('…and come back as a chain', s.linked.length === 2 && s.rails.some((r) => r.startsWith('^') && r.endsWith('v')), s);

  await R(`player.stop(); player.setOrder('sequential'); for (const id of store.getState().order) store.revertToSaved(id);`);
  w.close();
  await new Promise((r) => w.once('closed', r));
  log('ALL STEPS PASSED');
};
