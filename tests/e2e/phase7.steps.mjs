// Phase 7: playlist-side metadata — rename in place, per-track gain (ReplayGain seed, the cap,
// live preview), playlist properties and cover, custom grouping templates, the group editor,
// custom groups and Move to Group, and all of it surviving a save and a reopen elsewhere.
import fs from 'node:fs';
import { makeGif } from '../gif-fixture.mjs';
const { readBday } = await import(new URL('../../src/main/bday.mjs', import.meta.url));

const PRE = `(async () => {
  const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
  const store = await mod('/src/renderer/store/playlists.js'); const actions = await mod('/src/renderer/store/actions.js');
  const ui = await mod('/src/renderer/store/ui.js'); const cmds = await mod('/src/renderer/menus/commands.js'); const { player } = await mod('/src/renderer/audio/engine.js');
  const P = () => { const s = store.getState(); return s.playlists[s.viewedId]; };
  const byTitle = (title) => P().doc.tracks.find((t) => t.tags.title === title);
  const until = async (cond, ms = 3000) => { const t = performance.now(); while (!(await cond()) && performance.now() - t < ms) await new Promise((r) => setTimeout(r, 20)); };
  const groups = () => store.layoutOf(P()).groups?.map((g) => ({ key: g.key, main: g.mainName, subs: g.subNames, custom: g.custom, ids: g.trackIds, art: g.artUrl, description: g.description })) ?? null;
  const field = (selector) => { const el = document.querySelector(selector); el.focus(); el.select?.(); return Boolean(el); };
  const button = (text) => { const el = [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === text); el?.click(); return Boolean(el); };
`;

export default async ({ w, answers, log, S }) => {
  const H = S + '/home', M = H + '/Music';
  const flac = M + '/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', mp3 = M + '/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', wav = M + '/Breakcore/feel sooooo hard (renamed).wav';
  const R = (code) => w.webContents.executeJavaScript(PRE + code + '\n})()');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, cond, detail) => { if (!cond) throw new Error(`${name}\n    ${JSON.stringify(detail)}`); log('PASS', name); };
  const send = (e) => w.webContents.sendInputEvent(e);
  const key = async (keyCode, modifiers = []) => { send({ type: 'keyDown', keyCode, modifiers }); send({ type: 'char', keyCode, modifiers }); send({ type: 'keyUp', keyCode, modifiers }); await sleep(150); };
  const type = async (text) => { await w.webContents.insertText(text); await sleep(120); };
  const rightClick = async (p) => { send({ type: 'mouseDown', ...p, button: 'right', clickCount: 1 }); send({ type: 'mouseUp', ...p, button: 'right', clickCount: 1 }); await sleep(200); };
  const click = async (p) => { send({ type: 'mouseMove', ...p }); send({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 }); send({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); await sleep(200); };
  const centre = (selector, text) => w.webContents.executeJavaScript(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text ?? '')})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()`);
  const drag = async (from, to) => {
    send({ type: 'mouseDown', ...from, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) { send({ type: 'mouseMove', x: Math.round(from.x + ((to.x - from.x) * i) / 6), y: Math.round(from.y + ((to.y - from.y) * i) / 6), button: 'left' }); await sleep(40); }
    send({ type: 'mouseUp', ...to, button: 'left', clickCount: 1 }); await sleep(250);
  };
  const menuLabels = () => w.webContents.executeJavaScript(`[...document.querySelectorAll('.contextmenu [role=menuitem]')].map((e) => e.textContent)`);
  let s;

  const picture = H + '/Downloads/cover.gif';
  fs.writeFileSync(picture, makeGif(96, 96, 1));
  const groupPicture = H + '/Downloads/group.gif';
  fs.writeFileSync(groupPicture, makeGif(80, 80, 2, { delay: 50 }));

  answers.push({ kind: 'open', value: [flac, mp3, wav] });
  await R('await actions.addFiles(); document.querySelector(".tracklist__scroll").focus();');

  // --- Menus fit their labels (long ones wrap rather than being cut off) ---
  for (const menu of ['View', 'Options']) {
    await click(await centre('.menubar__label', menu));
    s = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.menubar .menu .menu__label')].map((e) => ({ text: e.textContent, cut: e.scrollWidth > e.clientWidth + 1 }))`);
    check(`the ${menu} menu shows every label in full`, s.length > 3 && s.every((l) => !l.cut), s);
    await key('Escape');
  }

  // --- Rename in place (F2) ---
  s = await R(`const t = byTitle('Fly Octo Fly'); store.play(P().id, t.id); store.setSelection(P().id, [t.id], { anchorId: t.id, focusId: t.id });
    await until(() => player.getState().status === 'playing'); return { status: player.getState().status };`);
  check('the MP3 plays', s.status === 'playing', s);
  await key('F2');
  s = await R(`const el = document.querySelector('.track__rename'); return { field: Boolean(el), focused: document.activeElement === el, value: el?.value, selected: el && el.selectionEnd - el.selectionStart };`);
  check('F2 opens the selected row’s title for editing, all selected', s.field && s.focused && s.value === 'Fly Octo Fly' && s.selected === 'Fly Octo Fly'.length, s);
  await type('Octo Flight');
  await key('Enter');
  s = await R(`const t = byTitle('Fly Octo Fly'); return { override: t.overrides.title, field: Boolean(document.querySelector('.track__rename')),
    row: [...document.querySelectorAll('.track__title')].map((e) => e.textContent), playing: player.getState().current.title, undo: cmds.resolveItem('edit.undo', cmds.getContext()).label,
    overlay: navigator.mediaSession.metadata?.title, tag: t.tags.title };`);
  check('Enter keeps the name: in the row, the transport and the OS overlay; the tag is untouched', s.override === 'Octo Flight' && !s.field && s.row.includes('Octo Flight') && s.playing === 'Octo Flight' && s.overlay === 'Octo Flight' && s.tag === 'Fly Octo Fly', s);
  check('…as one undo step', s.undo === 'Undo Rename Track', s);
  await key('F2');
  await type('Throwaway');
  await key('Escape');
  s = await R(`return { override: byTitle('Fly Octo Fly').overrides.title, field: Boolean(document.querySelector('.track__rename')), dialog: ui.getState().dialog };`);
  check('Escape drops an edit', s.override === 'Octo Flight' && !s.field, s);
  await key('F2');
  await key('Backspace');
  await key('Enter');
  s = await R(`return { overrides: byTitle('Fly Octo Fly').overrides, playing: player.getState().current.title };`);
  check('clearing the name goes back to the tag title', !('title' in s.overrides) && s.playing === 'Fly Octo Fly', s);
  await R(`actions.undo();`);
  s = await R(`return byTitle('Fly Octo Fly').overrides.title;`);
  check('undo brings the rename back', s === 'Octo Flight', s);

  // --- Gain ---
  s = await R(`const t = byTitle('Fly Octo Fly'); return { applied: player.getAppliedGainDb(), rg: t.tags.replayGainDb, resetEnabled: cmds.resolveItem('track.resetGain', cmds.getContext()).enabled,
    wav: byTitle('feel sooooo hard').tags.replayGainDb };`);
  const rg = s.rg;
  check('the MP3’s ReplayGain tag is its starting gain, applied as it plays; nothing to reset yet', rg < 0 && s.applied === rg && !s.resetEnabled, s);
  check('…the WAV has none (WAV has no tag standard), so it starts at 0 dB', s.wav == null, s);
  s = await R(`cmds.runCommand('track.gain'); await new Promise((r) => setTimeout(r, 150)); const f = document.querySelector('.gain__field');
    return { open: ui.getState().dialog, value: f?.value, focused: document.activeElement === f, text: document.querySelector('.modal').innerText };`);
  check('Track ▸ Adjust Gain… opens on the current value, explaining where it came from', s.open === 'gain' && s.value === String(rg) && s.focused && s.text.includes(`ReplayGain says −${-rg} dB`), s);
  await type('3');
  s = await R(`return { applied: player.getAppliedGainDb(), doc: byTitle('Fly Octo Fly').overrides.gainDb, hint: document.querySelector('.modal').innerText.includes('hearing the change') };`);
  check('typing previews on the playing track without changing the playlist', s.applied === 3 && s.doc === undefined && s.hint, s);
  await key('Escape');
  s = await R(`return { applied: player.getAppliedGainDb(), dialog: ui.getState().dialog };`);
  check('cancelling puts the gain back', s.applied === rg && s.dialog === null, s);
  await R(`cmds.runCommand('track.gain');`);
  await sleep(150);
  await type('20');
  s = await R(`return document.querySelector('.modal').innerText;`);
  check('over the cap, the dialog says so', /stop at \+12 dB/.test(s), s);
  await key('Enter');
  s = await R(`return { applied: player.getAppliedGainDb(), doc: byTitle('Fly Octo Fly').overrides.gainDb, undo: cmds.resolveItem('edit.undo', cmds.getContext()).label };`);
  check('Apply sets it, capped at +12 dB, live, undoably', s.applied === 12 && s.doc === 12 && s.undo === 'Undo Adjust Gain', s);
  s = await R(`cmds.runCommand('track.resetGain'); await new Promise((r) => setTimeout(r, 50)); return { applied: player.getAppliedGainDb(), overrides: byTitle('Fly Octo Fly').overrides };`);
  check('Reset Gain returns to the ReplayGain value', s.applied === rg && !('gainDb' in s.overrides), s);
  s = await R(`const ids = P().doc.tracks.map((t) => t.id); store.setSelection(P().id, ids); cmds.runCommand('track.gain'); await new Promise((r) => setTimeout(r, 150));
    return { title: document.querySelector('.modal__title').textContent, text: document.querySelector('.modal').innerText };`);
  check('several tracks with different gains: one dialog, and it says they differ', s.title === 'Gain for 3 tracks' && /different gains/.test(s.text), s);
  await type('-2');
  await key('Enter');
  s = await R(`return { gains: P().doc.tracks.map((t) => t.overrides.gainDb), applied: player.getAppliedGainDb() };`);
  check('…and sets them all', s.gains.every((g) => g === -2) && s.applied === -2, s);

  // --- Playlist properties ---
  s = await R(`cmds.runCommand('playlist.properties'); await new Promise((r) => setTimeout(r, 150)); return { dialog: ui.getState().dialog, focused: document.activeElement?.placeholder };`);
  check('Playlist ▸ Properties… opens with the name focused (placeholder: what it’s called now)', s.dialog === 'playlistProperties' && s.focused === 'Untitled', s);
  await type('Beach Mix');
  await R(`field('.meta input[placeholder^="Who"]');`);
  await type('Me');
  await R(`field('.meta textarea');`);
  await type('Songs for the sand.');
  answers.push({ kind: 'open', value: [picture] });
  await R(`button('Choose…'); await until(() => document.querySelector('.artpick__image'));`);
  s = await R(`return { preview: Boolean(document.querySelector('.artpick__image')), meta: P().doc.meta };`);
  check('choosing a cover previews it, but nothing is applied yet', s.preview && s.meta.name === '' && s.meta.cover === null, s);
  await R(`button('Apply');`);
  await sleep(150);
  s = await R(`return { meta: P().doc.meta, tab: document.querySelector('.tabstrip [aria-selected="true"]')?.textContent,
    header: document.querySelector('.tracklist__name').textContent, title: document.querySelector('.tracklist__heading').title, cover: Boolean(document.querySelector('.tracklist__header .tracklist__cover')), description: document.querySelector('.tracklist__description-text')?.textContent,
    toggle: Boolean(document.querySelector('.tracklist__description-toggle')),
    undo: cmds.resolveItem('edit.undo', cmds.getContext()).label };`);
  check('Apply names the playlist, with author, description and cover', s.meta.name === 'Beach Mix' && s.meta.author === 'Me' && s.meta.description === 'Songs for the sand.' && s.meta.cover?.startsWith('art/'), s);
  check('…shown in the tab, and the header: by author, cover, and the description under the name', /Beach Mix/.test(s.tab ?? '') && s.header.includes('Beach Mix') && s.header.includes('by Me') && s.cover && s.description === 'Songs for the sand.' && !s.toggle, s);
  check('…one undo step', s.undo === 'Undo Edit Playlist Properties', s);
  s = await R(`store.setMeta(P().id, { description: Array.from({ length: 12 }, (_, i) => 'Line ' + (i + 1)).join('\\n') }); await new Promise((r) => setTimeout(r, 100));
    const text = () => document.querySelector('.tracklist__description-text'); const before = text().clientHeight; const toggle = document.querySelector('.tracklist__description-toggle'); const first = toggle?.textContent;
    toggle?.click(); await new Promise((r) => setTimeout(r, 100)); const after = text().clientHeight; const label = document.querySelector('.tracklist__description-toggle')?.textContent;
    actions.undo(); await new Promise((r) => setTimeout(r, 50)); return { before, after, toggle: first, label, restored: P().doc.meta.description };`);
  check('a long description shows a few lines and “more”, which shows the rest', s.toggle === 'more' && s.label === 'less' && s.after > s.before * 2 && s.restored === 'Songs for the sand.', s);

  // --- Grouping: custom template ---
  s = await R(`store.setGrouping(P().id, 'album'); cmds.runCommand('playlist.grouping.custom'); await new Promise((r) => setTimeout(r, 150));
    return { dialog: ui.getState().dialog, key: document.activeElement?.value, previews: document.querySelectorAll('.grouppreview .group').length };`);
  check('Grouping ▸ Custom… opens on the current template with a live preview', s.dialog === 'grouping' && s.key === '%albumartist% / %album%' && s.previews > 0, s);
  await type('%codec%');
  await R(`field('input[name="mainName"]');`);
  await type('%codec% files');
  s = await R(`return [...document.querySelectorAll('.grouppreview .group__main')].map((e) => e.textContent);`);
  check('the preview follows the template as it’s typed', s.includes('mp3 files') && s.includes('wav files'), s);
  await R(`const f = document.querySelector('input[name="sub1"]'); f.focus(); f.select();`);
  await type('');
  await key('Backspace');
  await R(`[...document.querySelectorAll('.tokens__token')].find((b) => b.textContent === '%tracks%').click();`);
  await sleep(100);
  s = await R(`return { v: document.querySelector('input[name="sub1"]').value };`);
  s = s.v;
  check('clicking a token inserts it into the field being edited', s === '%tracks%', s);
  await R(`button('Apply');`);
  await sleep(150);
  s = await R(`return { grouping: P().doc.grouping, groups: groups().map((g) => g.main), checked: cmds.resolveItem('playlist.grouping.custom', cmds.getContext()).checked };`);
  check('Apply groups by the custom template (✓ Custom…)', s.grouping.preset === 'custom' && s.grouping.groupKey === '%codec%' && s.checked && s.groups.includes('flac files'), s);
  await R(`cmds.runCommand('playlist.grouping.custom'); await new Promise((r) => setTimeout(r, 150)); button('By Album'); await new Promise((r) => setTimeout(r, 50)); button('Apply');`);
  s = await R(`return P().doc.grouping.preset;`);
  check('a custom template identical to a preset is that preset', s === 'album', s);

  // --- Custom groups and the group editor ---
  s = await R(`const ids = [byTitle('feel sooooo hard').id, byTitle('Cryogenic Hopetown')?.id ?? P().doc.tracks[0].id]; store.setSelection(P().id, ids);
    await new Promise((r) => setTimeout(r, 50)); return groups().length;`);
  const before = s;
  // A real right-click on a track, then Move to Group ▸ New Group….
  const row = await centre('.track', 'feel sooooo hard');
  await rightClick(row);
  let at = await centre('.contextmenu [role=menuitem]', 'Move to Group');
  send({ type: 'mouseMove', ...at });
  await sleep(200);
  s = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.menu--nested [role=menuitem]')].map((e) => e.textContent)`);
  check('right-click ▸ Move to Group lists the groups, then New Group… and By Tags', s.length >= before + 2 && s.some((l) => l.includes('New Group')) && s.some((l) => l.includes('By Tags')), s);
  await click(await centre('.menu--nested [role=menuitem]', 'New Group'));
  s = await R(`return { dialog: ui.getState().dialog, focused: document.activeElement?.name, groups: groups() };`);
  const fav = s.groups.find((g) => g.custom);
  check('New Group… makes a custom group of the selection and opens the editor on its name', s.dialog === 'groups' && s.focused === 'mainName' && fav?.ids.length === 2 && fav.main === 'New Group', s);
  await type('Favourites');
  await R(`field('.groupedit textarea');`);
  await type('The ones on repeat.');
  answers.push({ kind: 'open', value: [groupPicture] });
  await R(`button('Choose…'); await until(() => document.querySelector('.groupedit .artpick__image'));`);
  s = await R(`return { preview: document.querySelector('.groupedit .grouppreview .group__main').textContent, listed: [...document.querySelectorAll('.groupedit__name')].map((e) => e.textContent), doc: groups().find((g) => g.custom).main };`);
  check('the editor previews the header and list as you type, applying nothing yet', s.preview === 'Favourites' && s.listed.includes('Favourites') && s.doc === 'New Group', s);
  // Edit a tag group too, in the same dialog session: its header gets a template override.
  await R(`[...document.querySelectorAll('.groupedit__item')].find((e) => !e.textContent.includes('custom')).click();`);
  await sleep(100);
  s = await R(`return document.querySelector('input[name="mainName"]').placeholder;`);
  const tagGroupName = s;
  check('a tag group’s empty header field shows what the grouping gives it', s && s !== 'Favourites', s);
  await R(`field('input[name="mainName"]');`);
  await type('%album% (OST)');
  await R(`button('Apply');`);
  await sleep(150);
  s = await R(`return { groups: groups(), undo: cmds.resolveItem('edit.undo', cmds.getContext()).label, entry: P().doc.groups };`);
  const favGroup = s.groups.find((g) => g.custom);
  check('Apply: the custom group is named, described and has its art', favGroup.main === 'Favourites' && favGroup.description === 'The ones on repeat.' && favGroup.art?.endsWith('.gif'), s);
  check('…the tag group shows its override', s.groups.some((g) => g.main === `${tagGroupName} (OST)`), s.groups);
  check('…as one undo step', s.undo === 'Undo Edit Groups', s);
  s = await R(`const header = [...document.querySelectorAll('.tracklist__canvas > .group')].find((g) => g.querySelector('.group__description'));
    const rect = header.getBoundingClientRect(); const below = [...document.querySelectorAll('.tracklist__canvas > .track, .tracklist__canvas > .group')].map((e) => e.getBoundingClientRect()).filter((r) => r.top > rect.top);
    return { text: header.querySelector('.group__description').textContent, height: Math.round(rect.height), next: Math.round(Math.min(...below.map((r) => r.top))), bottom: Math.round(rect.bottom) };`);
  check('a group’s description shows under its header lines; the row grows and the rows below make room', s.text === 'The ones on repeat.' && s.height > 74 && s.next >= s.bottom, s);

  // Right-click a group header: its own menu.
  await rightClick(await centre('.group', `${tagGroupName} (OST)`));
  s = await menuLabels();
  check('right-clicking a group header opens the group menu', s.some((l) => l.includes('Edit Group')) && s.some((l) => l.includes('Set Group Art')) && s.some((l) => l.includes('Collapse All')), s);
  answers.push({ kind: 'open', value: [picture] });
  await click(await centre('.contextmenu [role=menuitem]', 'Set Group Art'));
  await sleep(300);
  s = await R(`return { group: groups().find((g) => g.main.endsWith('(OST)')), undo: cmds.resolveItem('edit.undo', cmds.getContext()).label };`);
  check('Set Group Art… from the header menu', s.group.art?.startsWith('beachday-media://art/') && s.undo === 'Undo Set Group Art', s);

  // Move the MP3 into Favourites (a pin), then back to its tags.
  s = await R(`const t = byTitle('Fly Octo Fly'); store.setSelection(P().id, [t.id]); const fav = groups().find((g) => g.custom);
    store.moveToGroup(P().id, [t.id], fav.key); await new Promise((r) => setTimeout(r, 50));
    return { pin: byTitle('Fly Octo Fly').groupId, fav: groups().find((g) => g.custom).ids.length, queue: player.getState().queue.map((q) => q.id), order: store.layoutOf(P()).order, current: player.getState().current.id, index: player.getState().index };`);
  check('Move to Group pins a track; playback follows the new display order', s.pin?.startsWith('custom:') && s.fav === 3 && JSON.stringify(s.queue) === JSON.stringify(s.order) && s.queue[s.index] === s.current, s);
  await R(`cmds.runCommand('track.ungroup');`);
  s = await R(`return byTitle('Fly Octo Fly').groupId;`);
  check('Move to Group ▸ By Tags unpins it', s === null, s);
  // Dragging a track onto a custom group moves it in, where it's dropped.
  const from = await centre('.track', 'Octo Flight');
  const target = await R(`const fav = groups().find((g) => g.custom); const el = [...document.querySelectorAll('.track')].find((e) => e.textContent.includes(P().doc.tracks.find((t) => t.id === fav.ids[1]).tags.title));
    const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + 4) };`);
  await drag(from, target);
  s = await R(`const fav = groups().find((g) => g.custom); return { ids: fav.ids.map((id) => P().doc.tracks.find((t) => t.id === id).tags.title), pin: byTitle('Fly Octo Fly').groupId, key: fav.key, undo: cmds.resolveItem('edit.undo', cmds.getContext()).label };`);
  check('dragging a track onto a custom group moves it in, where it was dropped, in one step', s.pin === s.key && s.ids.length === 3 && s.ids[1] === 'Fly Octo Fly' && s.undo === 'Undo Move Track to Group', s);
  await R(`actions.undo();`);

  // --- Save, and reopen as if on another machine ---
  answers.push({ kind: 'save', value: H + '/Playlists/p7.bday' });
  await R('await actions.saveViewed();');
  const saved = await readBday(H + '/Playlists/p7.bday');
  const { manifest } = saved;
  const savedFav = manifest.groups.find((g) => g.custom);
  check('the .bday carries name, author, description and cover (in art/)', manifest.meta.name === 'Beach Mix' && manifest.meta.author === 'Me' && saved.art.has(manifest.meta.cover), manifest.meta);
  check('…the custom group, its description and art, and the pins to it', savedFav?.mainName === 'Favourites' && savedFav.description === 'The ones on repeat.' && saved.art.has(savedFav.art) && manifest.tracks.filter((t) => t.groupId === savedFav.key).length === 2, manifest.groups);
  check('…the tag group’s header override', manifest.groups.some((g) => g.mainName === '%album% (OST)' && saved.art.has(g.art)), manifest.groups);
  check('…and every track’s rename and gain', manifest.tracks.find((t) => t.tags.title === 'Fly Octo Fly').overrides.title === 'Octo Flight' && manifest.tracks.every((t) => t.overrides.gainDb === -2), manifest.tracks.map((t) => t.overrides));

  fs.rmSync(S + '/userdata/art-cache', { recursive: true, force: true });
  await R(`player.stop(); await actions.closeViewed();`);
  answers.push({ kind: 'open', value: [H + '/Playlists/p7.bday'] });
  await R('await actions.openPlaylist();');
  s = await R(`return { meta: P().doc.meta, groups: groups(), header: document.querySelector('.tracklist__name').textContent };`);
  const reFav = s.groups.find((g) => g.custom);
  check('reopened with an empty art cache: name, author, groups, overrides and art all back', s.meta.name === 'Beach Mix' && s.header.includes('by Me') && reFav?.main === 'Favourites' && reFav.ids.length === 2 && reFav.art && s.groups.some((g) => g.main.endsWith('(OST)') && g.art), s);
  s = await R(`const t = byTitle('Fly Octo Fly'); store.play(P().id, t.id); await until(() => player.getState().status === 'playing'); return { applied: player.getAppliedGainDb(), title: player.getState().current.title };`);
  check('…and the track plays under its playlist name at its playlist gain', s.applied === -2 && s.title === 'Octo Flight', s);

  // --- Dissolving, resetting ---
  s = await R(`const fav = groups().find((g) => g.custom); store.setSelection(P().id, fav.ids); cmds.runCommand('group.edit'); await new Promise((r) => setTimeout(r, 150));
    const selected = document.querySelector('.groupedit__item--selected')?.textContent; button('Dissolve Group'); await new Promise((r) => setTimeout(r, 50)); button('Apply');
    await new Promise((r) => setTimeout(r, 100)); return { selected, groups: groups(), pins: P().doc.tracks.map((t) => t.groupId) };`);
  check('Edit Group… on a custom group, then Dissolve: its tracks go back to their tag groups', /Favourites/.test(s.selected ?? '') && !s.groups.some((g) => g.custom) && s.pins.every((p) => !p), s);
  s = await R(`const t = byTitle('Fly Octo Fly'); store.setSelection(P().id, [t.id]); cmds.runCommand('track.resetOverrides'); return byTitle('Fly Octo Fly');`);
  check('Reset All Overrides: the file’s own name and its ReplayGain-or-0 gain', Object.keys(s.overrides).length === 0 && !s.groupId, s);
  answers.push({ kind: 'save', value: H + '/Playlists/p7.bday' });
  await R('await actions.saveViewed({ saveAs: true });');
  const after = (await readBday(H + '/Playlists/p7.bday')).manifest;
  check('a custom group with nothing in it isn’t saved', !after.groups.some((g) => g.custom), after.groups);
  // New Group… with grouping off: Custom Groups Only, not a regroup by tags.
  await R(`store.setGrouping(P().id, null); const t = byTitle('Fly Octo Fly'); store.setSelection(P().id, [t.id], { anchorId: t.id, focusId: t.id });`);
  await rightClick(await centre('.track', 'Fly Octo Fly'));
  at = await centre('.contextmenu [role=menuitem]', 'Move to Group');
  send({ type: 'mouseMove', ...at });
  await sleep(200);
  s = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.menu--nested [role=menuitem]')].map((e) => ({ label: e.textContent, disabled: e.getAttribute('aria-disabled') }))`);
  check('with grouping off, Move to Group still offers New Group…', s.length === 1 && s[0].label.includes('New Group') && s[0].disabled === 'false', s);
  await click(await centre('.menu--nested [role=menuitem]', 'New Group'));
  await type('Solo');
  await key('Enter');
  await R(`button('Apply');`);
  await sleep(150);
  s = await R(`return { preset: P().doc.grouping?.preset, groups: groups().map((g) => [g.main, g.ids.length]), checked: cmds.resolveItem('playlist.grouping.manual', cmds.getContext()).checked };`);
  check('…which turns on Custom Groups Only: the new group, and everything else Ungrouped', s.preset === 'manual' && s.checked && JSON.stringify(s.groups) === JSON.stringify([['Ungrouped Tracks', 2], ['Solo', 1]]), s);

  await R(`for (const id of store.getState().order) store.revertToSaved(id);`);
  w.close();
  await new Promise((r) => w.once('closed', r));
  log('ALL STEPS PASSED');
};
