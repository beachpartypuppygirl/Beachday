// End-to-end tests: the real app, driven by scripts. `npm run test:e2e`
//
// Each suite launches tests/e2e/harness.mjs in Electron against a fresh work
// folder (tests/fixtures.mjs). The harness loads the real main.mjs with native
// dialogs answered from the script and the window kept hidden. The renderer
// comes from the Vite dev server, which is started here if it isn't running.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';
import { ROOT, makeWorkDir, removeWorkDir } from './fixtures.mjs';

const here = (file) => fileURLToPath(new URL(file, import.meta.url));
const DEV_SERVER = 'http://localhost:5173';
// Chromium's GPU/VA-API complaints on Linux: noise, not failures.
const NOISE = /vaapi|WebGL|gpu\/|zygote|network_service/;

async function ensureDevServer() {
  const up = () => fetch(DEV_SERVER).then(() => true, () => false);
  if (await up()) return null;
  const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js')], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  return vite;
}

function runSuite(name, stepsFile, work) {
  return new Promise((resolve) => {
    const env = { ...process.env, BEACHDAY_TEST_DIR: work, STEPS: pathToFileURL(here(stepsFile)).href };
    delete env.ELECTRON_RUN_AS_NODE; // Set in VS Code's terminals; makes Electron plain Node.
    console.log(`\n# ${name}`);
    const child = spawn(electronPath, [here('e2e/harness.mjs')], { env });
    let output = '';
    const onData = (data) => {
      output += data;
      for (const line of String(data).split('\n')) if (line.trim() && !NOISE.test(line)) console.log(line);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && /ALL STEPS PASSED/.test(output));
    });
  });
}

// Each group shares one work folder; its suites run in order (a restart suite reuses the first's state).
const GROUPS = [
  {
    // Phase 4: format, storage conversion mid-playback, relinking a Windows-made playlist, quit prompts.
    label: 'e2e4',
    prepare: (work) =>
      new Promise((resolve) =>
        spawn(process.execPath, [here('e2e/make-windows-playlist.mjs'), work], { stdio: 'inherit' }).on('exit', resolve)
      ),
    suites: [['phase 4', 'e2e/phase4.steps.mjs']],
  },
  {
    // Phase 5: list, selection, drag, clipboard, grouping, tabs, 5,000 tracks; then a restart.
    label: 'e2e5',
    suites: [
      ['phase 5', 'e2e/phase5.steps.mjs'],
      ['phase 5 restart', 'e2e/phase5-restart.steps.mjs'],
    ],
  },
  {
    // Phase 6: art pane split, art chain, custom art in the .bday, GIF guardrail and pausing.
    label: 'e2e6',
    suites: [['phase 6', 'e2e/phase6.steps.mjs']],
  },
];

// E2E_ONLY=6 runs only the groups with a suite whose name contains "6".
const only = process.env.E2E_ONLY;
const vite = await ensureDevServer();
const results = [];
try {
  for (const group of GROUPS) {
    if (only && !group.suites.some(([name]) => name.includes(only))) continue;
    const work = await makeWorkDir(group.label);
    await group.prepare?.(work);
    for (const [name, file] of group.suites) results.push([name, await runSuite(name, file, work)]);
    await removeWorkDir(work);
  }
} finally {
  vite?.kill();
}

console.log('\n' + results.map(([name, ok]) => `${ok ? 'ok  ' : 'FAIL'} ${name}`).join('\n'));
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
