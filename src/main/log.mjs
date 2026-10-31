import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * A log file for packaged builds, which swallow stdout and stderr.
 * Help ▸ Open Log Folder is how a friend finds it to send it over.
 * No Electron imports. Logging must never be what breaks the app, so failures
 * here are ignored.
 */

const MAX_BYTES = 1024 * 1024;

let logFile = null;
let writing = Promise.resolve();

/** Start logging into `dir`. A log that's grown too big becomes beachday.old.log. */
export async function startLog(dir) {
  try {
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, 'beachday.log');
    const { size } = await stat(target).catch(() => ({ size: 0 }));
    if (size > MAX_BYTES) await rename(target, path.join(dir, 'beachday.old.log'));
    logFile = target;
  } catch {
    logFile = null;
  }
}

export function log(message) {
  if (!logFile) return;
  const line = `${new Date().toISOString()} ${message}\n`;
  writing = writing.then(() => appendFile(logFile, line)).catch(() => {});
}
