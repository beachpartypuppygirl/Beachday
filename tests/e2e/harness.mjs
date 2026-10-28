// E2E harness: the REAL main.mjs, with native dialogs answered from a script.
// Launched by tests/run-e2e.mjs as: electron harness.mjs, with
//   BEACHDAY_TEST_DIR  work folder (home/, userdata/, out/) built by tests/fixtures.mjs
//   STEPS              file URL of a *.steps.mjs module: export default async ({ w, answers, log, S, shot })
// Dialog answers are queued in `answers` as { kind: 'open' | 'save' | 'message', value }.
import { app, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
const S = process.env.BEACHDAY_TEST_DIR;
app.setPath('userData', S + '/userdata');   // before main.mjs takes the single-instance lock
const answers = [];
const log = (...a) => console.log(...a);
const next = (kind, opts) => { const a = answers.shift(); log(`  [dialog] ${kind}: ${opts?.title ?? opts?.message} -> ${JSON.stringify(a)}`); if (!a || a.kind !== kind) throw new Error('unexpected dialog ' + kind); return a.value; };
dialog.showOpenDialog = async (_w, o) => ({ canceled: false, filePaths: next('open', o) });
dialog.showSaveDialog = async (_w, o) => ({ canceled: false, filePath: next('save', o) });
dialog.showMessageBox = async (_w, o) => ({ response: next('message', o) });
BrowserWindow.prototype.show = function () {};   // stay hidden
globalThis.__answers = answers;
await import(new URL('../../src/main/main.mjs', import.meta.url));
app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1400, 900);
  w.webContents.audioMuted = true;
  w.webContents.setBackgroundThrottling(false);
  w.webContents.on('console-message', (e) => { const m = e.message ?? e; if (!/Download the React|Electron Security|\[vite\]/.test(m)) log('  [console]', m); });
  await new Promise((r) => (w.webContents.isLoading() ? w.webContents.once('did-finish-load', r) : r()));
  await new Promise((r) => setTimeout(r, 800));
  const steps = (await import(process.env.STEPS)).default;
  try { await steps({ w, answers, log, S, shot: async (n) => { w.webContents.invalidate(); await new Promise((r) => setTimeout(r, 400)); fs.writeFileSync(`${S}/${n}.png`, (await w.webContents.capturePage()).toPNG()); } }); }
  catch (e) { log('STEP FAILED:', e.stack ?? e); app.exit(1); }
});
