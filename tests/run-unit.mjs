// Unit tests for the Electron-free modules. `npm run test:unit`
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeWorkDir, removeWorkDir } from './fixtures.mjs';

const work = await makeWorkDir('unit');
let failed = false;
for (const [file, args] of [['unit/core.test.mjs', [work]], ['unit/grouping.test.mjs', []], ['unit/gif.test.mjs', []], ['unit/symbols.test.mjs', []]]) {
  console.log(`\n# ${file}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
await removeWorkDir(work);
console.log(failed ? '\nUNIT TESTS FAILED' : '\nAll unit tests passed.');
process.exit(failed ? 1 : 0);
