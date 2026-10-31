// Phase 9: per-playlist palettes. The Colors dialog (live preview, Cancel, Apply, undo), presets, light
// themes, contrast adjustment, suggestions from art, theming following the viewed tab, the palette in the .bday.
const { readBday, writeBday } = await import(new URL('../../src/main/bday.mjs', import.meta.url));

const PRE = `(async () => {
  const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
  const store = await mod('/src/renderer/store/playlists.js'); const actions = await mod('/src/renderer/store/actions.js');
  const ui = await mod('/src/renderer/store/ui.js'); const cmds = await mod('/src/renderer/menus/commands.js'); const { player } = await mod('/src/renderer/audio/engine.js');
  const theme = await mod('/src/renderer/store/theme.js');
  const P = () => { const s = store.getState(); return s.playlists[s.viewedId]; };
  const token = (name) => document.documentElement.style.getPropertyValue(name) || getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const look = () => ({ bg: token('--bg'), accent: token('--accent'), highlight: token('--highlight'), mode: document.documentElement.dataset.theme, scheme: document.documentElement.style.colorScheme, body: getComputedStyle(document.body).backgroundColor });
  const button = (text) => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === text);
  const hex = (label) => document.querySelector('[aria-label="' + label + ' hex"]');
  const typeInto = (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
  const tick = () => new Promise((r) => setTimeout(r, 60));
`;

export default async ({ w, answers, log, S }) => {
  const H = S + '/home', M = H + '/Music';
  const flac = M + '/Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', mp3 = M + '/Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', wav = M + '/Breakcore/feel sooooo hard (renamed).wav';
  const R = (code) => w.webContents.executeJavaScript(PRE + code + '\n})()');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, cond, detail) => { if (!cond) throw new Error(`${name}\n    ${JSON.stringify(detail)}`); log('PASS', name); };
  const send = (e) => w.webContents.sendInputEvent(e);
  const key = async (keyCode, modifiers = []) => { send({ type: 'keyDown', keyCode, modifiers }); send({ type: 'char', keyCode, modifiers }); send({ type: 'keyUp', keyCode, modifiers }); await sleep(150); };
  const open = () => R(`cmds.runCommand('playlist.colors'); await tick();`);
  let s;

  // --- The default look ---
  s = await R(`const item = cmds.MENUS.find((m) => m.label === 'Playlist').items; return { hasItem: item.includes('playlist.colors'), look: look(), doc: P().doc.palette };`);
  check('Playlist ▸ Colors… is in the menu; a new playlist has no palette and the default look', s.hasItem && s.doc === null && s.look.bg === '#14110f' && s.look.mode === 'dark', s);

  answers.push({ kind: 'open', value: [flac, wav] });
  await R(`await actions.addFiles();`);
  await open();
  s = await R(`return { primary: hex('Primary').value, secondary: hex('Secondary').value, tertiary: hex('Tertiary').value, focused: document.activeElement === hex('Primary'), on: document.querySelector('.preset--on')?.textContent };`);
  check('the dialog opens on the default colours, the first field focused, Beachday marked', s.primary === '#14110f' && s.secondary === '#4fc9a9' && s.tertiary === '#f07fbf' && s.focused && s.on === 'Beachday', s);

  // --- Live preview, Cancel ---
  await R(`typeInto(hex('Primary'), '#102030'); await tick();`);
  s = await R(`return { look: look(), doc: P().doc.palette, dirty: store.isDirty(P()) };`);
  check('typing a colour previews it across the app, without touching the document', s.look.bg === '#102030' && s.look.body === 'rgb(16, 32, 48)' && s.doc === null, s);
  await key('Escape');
  s = await R(`return { look: look(), doc: P().doc.palette, dialog: ui.getState().dialog, preview: ui.getState().palettePreview };`);
  check('Escape cancels: the look goes back and nothing is kept', s.look.bg === '#14110f' && s.doc === null && s.dialog === null && s.preview === null, s);

  // --- Typing: partial, short, bad ---
  await open();
  s = await R(`typeInto(hex('Primary'), '#12'); await tick(); const bad = { bg: look().bg, marked: hex('Primary').classList.contains('colors__hex--bad'), apply: Boolean(button('Apply')) };
    typeInto(hex('Primary'), '#f00'); await tick(); const short = { bg: theme.deriveTheme({ primary: '#ff0000', secondary: '#4fc9a9', tertiary: '#f07fbf' }).tokens['--bg'], applied: look().bg, text: hex('Primary').value };
    typeInto(hex('Primary'), '#12'); hex('Primary').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await tick();
    return { bad, short, restored: hex('Primary').value };`);
  check('a half-typed colour changes nothing and is marked', s.bad.bg === '#14110f' && s.bad.marked, s);
  check('…a three-digit colour works and stays as typed', s.short.applied === s.short.bg && s.short.text === '#f00', s);
  check('…leaving the field restores the current colour', s.restored === '#ff0000', s);

  // --- The native picker ---
  s = await R(`typeInto(document.querySelector('[aria-label="Secondary colour"]'), '#00ff88'); await tick(); return { hex: hex('Secondary').value, accent: look().accent };`);
  check('the native picker drives the same colour', s.hex === '#00ff88' && s.accent !== '#4fc9a9', s);
  await R(`ui.closeDialog(); await tick();`);

  // --- Apply, undo, redo ---
  await open();
  s = await R(`typeInto(hex('Primary'), '#102030'); typeInto(hex('Secondary'), '#ff8844'); typeInto(hex('Tertiary'), '#88ddff'); await tick(); return document.querySelector('.modal__message').textContent;`);
  check('the dialog says what kind of theme it is', s === 'A dark theme.', s);
  await key('Enter');
  s = await R(`return { look: look(), doc: P().doc.palette, dirty: store.isDirty(P()), undo: cmds.resolveItem('edit.undo', cmds.getContext()).label, dialog: ui.getState().dialog };`);
  check('Enter applies, as one undoable edit that marks the playlist unsaved', s.doc?.primary === '#102030' && s.doc.secondary === '#ff8844' && s.doc.tertiary === '#88ddff' && s.look.bg === '#102030' && s.dirty && s.undo === 'Undo Change Colors' && s.dialog === null, s);
  await key('Z', ['control']);
  s = await R(`return { look: look(), doc: P().doc.palette };`);
  check('Ctrl+Z undoes it', s.doc === null && s.look.bg === '#14110f', s);
  await key('Y', ['control']);
  s = await R(`return { look: look(), doc: P().doc.palette };`);
  check('Ctrl+Y redoes it', s.doc?.primary === '#102030' && s.look.bg === '#102030', s);

  // --- Presets and light themes ---
  await open();
  s = await R(`button('Sand').click(); await tick(); const on = document.querySelector('.preset--on')?.textContent; const message = document.querySelector('.modal__message').textContent; button('Apply').click(); await tick();
    return { on, message, look: look(), doc: P().doc.palette, used: theme.deriveTheme(P().doc.palette).used };`);
  check('a light preset makes a truly light app', s.on === 'Sand' && s.message === 'A light theme.' && s.look.mode === 'light' && s.look.scheme === 'light' && s.look.bg === '#f4ecdf' && s.look.body === 'rgb(244, 236, 223)', s);

  // --- Contrast: a note when a colour moves ---
  await open();
  s = await R(`const notes = () => [...document.querySelectorAll('.colors__note')].map((n) => n.textContent);
    const none = notes();
    typeInto(hex('Primary'), '#f8e8ee'); typeInto(hex('Secondary'), '#f9d5e5'); await tick();
    return { none, moved: notes(), expected: theme.deriveTheme({ primary: '#f8e8ee', secondary: '#f9d5e5', tertiary: P().doc.palette.tertiary }).tokens['--accent'], accent: look().accent, field: hex('Secondary').value };`);
  check('presets need no adjusting; a pastel accent is shown darker, and the dialog says so, keeping the colour picked', s.none.length === 0 && s.moved.some((note) => note.includes(s.expected)) && s.accent === s.expected && s.field === '#f9d5e5', s);
  await R(`ui.closeDialog(); await tick();`);

  // --- Suggest from art ---
  await open();
  s = await R(`return { disabled: button('Suggest from Art').disabled };`);
  await R(`ui.closeDialog(); await tick();`);
  check('with no art in the playlist, Suggest from Art is off', s.disabled === true, s);
  answers.push({ kind: 'open', value: [mp3] });
  await R(`await actions.addFiles(); await tick();`);
  await open();
  s = await R(`const suggest = button('Suggest from Art'); const take = async () => { suggest.click(); for (let i = 0; i < 100 && !/Suggestion|couldn/.test(document.querySelector('.modal__message').textContent); i++) await tick(); await tick();
      return { message: document.querySelector('.modal__message').textContent, primary: hex('Primary').value, mode: look().mode }; };
    const off = suggest.disabled; const one = await take(); const two = await take(); const three = await take(); const four = await take();
    return { off, one, two, three, four };`);
  check('Suggest from Art reads the art, and each click gives the next reading', !s.off && s.one.message === 'Suggestion 1 of 3. Click again for another.' && s.two.message === 'Suggestion 2 of 3. Click again for another.' && s.one.primary !== s.two.primary && s.four.primary === s.one.primary, s);
  check('…a deep one and a light one', s.one.mode === 'dark' && s.two.mode === 'light', s);
  await R(`button('Beachday').click(); await tick(); button('Apply').click(); await tick();`);
  s = await R(`return { doc: P().doc.palette, look: look() };`);
  check('the Beachday preset returns a playlist to no palette at all', s.doc === null && s.look.bg === '#14110f' && s.look.mode === 'dark', s);

  // --- Follows the viewed tab; saved in the .bday ---
  await open();
  await R(`button('Forest').click(); await tick(); button('Apply').click(); await tick();`);
  const file = H + '/Playlists/p9.bday';
  answers.push({ kind: 'save', value: file });
  await R(`await actions.saveViewed();`);
  const saved = await readBday(file);
  check('the palette is written into the .bday', saved.manifest.palette?.primary === '#101a14' && saved.manifest.palette.secondary === '#7bc47f' && saved.manifest.palette.tertiary === '#e6c35c', saved.manifest.palette);
  s = await R(`const first = P().id; const track = P().doc.tracks[0].id; store.play(first, track); await tick();
    actions.newPlaylist(); await tick(); const second = { look: look(), status: player.getState().status, current: player.getState().current?.id === track };
    store.viewPlaylist(first); await tick(); const back = look(); store.viewAdjacent(1); await tick(); return { second, back, again: look() };`);
  check('theming follows the viewed tab, and playback carries on', s.second.look.bg === '#14110f' && s.second.current && s.back.bg === '#101a14' && s.again.bg === '#14110f', s);

  await R(`player.stop(); actions.closeViewed(); await tick();`);
  await R(`await actions.closeViewed(); await tick();`);
  s = await R(`return { look: look(), tabs: store.getState().order.length };`);
  check('closing the tabs returns to the default look', s.look.bg === '#14110f' && s.tabs === 1, s);
  answers.push({ kind: 'open', value: [file] });
  await R(`await actions.openPlaylist(); await tick();`);
  s = await R(`return { look: look(), doc: P().doc.palette, dirty: store.isDirty(P()) };`);
  check('reopening the file brings its colours back, clean', s.look.bg === '#101a14' && s.doc?.tertiary === '#e6c35c' && !s.dirty, s);

  // --- A .bday is untrusted ---
  const hostile = H + '/Playlists/hostile.bday';
  const manifest = (palette) => ({ formatVersion: 1, bundled: false, meta: { name: 'hostile' }, palette, grouping: null, groups: [], tracks: [] });
  await writeBday(hostile, manifest({ primary: 'url(http://example.com/x)', secondary: '#ffffff', tertiary: '#000000' }));
  answers.push({ kind: 'open', value: [hostile] });
  await R(`await actions.openPlaylist(); await tick();`);
  s = await R(`return { look: look(), doc: P().doc.palette, name: P().doc.meta.name };`);
  check('a malformed palette in a .bday is dropped', s.name === 'hostile' && s.doc === null && s.look.bg === '#14110f', s);

  await R(`for (const id of store.getState().order) store.revertToSaved(id);`);
  w.close();
  await new Promise((r) => w.once('closed', r));
  log('ALL STEPS PASSED');
};
