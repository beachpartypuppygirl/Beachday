export default async ({ w, log, S }) => {
  const R = (code) => w.webContents.executeJavaScript(`(async () => { const mod = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes(p)).pop() ?? p);
    const store = await mod('/src/renderer/store/playlists.js'); ${code} })()`);
  const check = (name, cond, detail) => { if (!cond) throw new Error(`${name}\n    ${JSON.stringify(detail)}`); log('PASS', name); };
  await new Promise((r) => setTimeout(r, 800));
  let s = await R(`const st = store.getState(); return st.order.map((id) => { const p = st.playlists[id]; return { name: store.playlistName(p), loaded: p.loaded, err: p.loadError, n: p.doc.tracks.length, grouping: p.doc.grouping?.preset ?? null, collapsed: p.view.collapsed.size, viewed: id === st.viewedId }; });`);
  check('restart restores both tabs; the active one loads, the other waits', s.length === 2 && s[0].loaded && s[0].viewed && s[0].n === 3 && s[0].grouping === 'album' && s[0].collapsed === 1 && !s[1].loaded && !s[1].err, s);
  s = await R(`store.viewPlaylist(store.getState().order[1]); await new Promise((r) => setTimeout(r, 500)); const p = store.getState().playlists[store.getState().order[1]]; return { loaded: p.loaded, err: p.loadError, text: document.querySelector('.tracklist__empty')?.innerText };`);
  check('the tab whose file is gone says so when viewed', !s.loaded && s.err === 'missing' && /isn’t where it was/.test(s.text), s);
  log('ALL STEPS PASSED (run 2)');
  w.destroy();
};
