// A playlist "saved on Windows": paths under C:\Users\Me, tag snapshots, no audio.
const M = new URL('../../src/main/', import.meta.url).href;
const { writeBday } = await import(M + 'bday.mjs');
const { fingerprint } = await import(M + 'fingerprint.mjs');
import fs from 'node:fs/promises';
const H = process.argv[2] + '/home';
const t = async (id, rel, win, title, artist) => { const p = H + '/Music/' + rel; const size = (await fs.stat(p)).size; return { id, relPath: '../Music/' + rel, absPath: 'C:\\Users\\Me\\Music\\' + win, size, fingerprint: await fingerprint({ path: p, size }), tags: { title, artist, duration: 100 }, overrides: {}, groupId: null, linkNext: null }; };
const tracks = [
  await t('w1', 'Splatoon/Splatoon 3 - Cryogenic Hopetown.flac', 'Splatoon\\Splatoon 3 - Cryogenic Hopetown.flac', 'Cryogenic Hopetown', 'Splatoon 3'),
  await t('w2', 'Splatoon/Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', 'Splatoon\\Splatoon 2 Octo Expansion - Fly Octo Fly.mp3', 'Fly Octo Fly', 'Splatoon 2: Octo Expansion'),
  await t('w3', 'Breakcore/feel sooooo hard (renamed).wav', 'Breakcore\\feel sooooo hard.wav', 'feel sooooo hard', 'darkmagiciangirl'),
  { id: 'w4', relPath: '../Music/Gone/missing.flac', absPath: 'C:\\Users\\Me\\Music\\Gone\\missing.flac', size: 5, fingerprint: 'sha256:x', tags: { title: 'Truly Gone', duration: 60 }, overrides: {} },
];
await writeBday(H + '/Downloads/inbox/from-windows.bday', { formatVersion: 1, bundled: false, meta: { name: 'Friend’s Mix', description: '', author: 'friend' }, tracks });
