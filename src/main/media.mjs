import { protocol } from 'electron';
import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { resolveArtPath, ART_CONTENT_TYPES } from './art.mjs';

/**
 * The beachday-media:// protocol: how the renderer reaches local files
 * without having filesystem access of its own.
 *
 *   beachday-media://track/<token>   an audio file the user has chosen
 *   beachday-media://art/<name>      an image in the art cache (art.mjs)
 *
 * Main hands out an opaque URL per audio file the user has chosen, and the
 * handler serves only those. The
 * renderer can't construct a URL for an arbitrary path, and Windows paths
 * (drive letters, backslashes) never have to survive URL encoding.
 *
 * Range requests are required, not optional: Chromium's media pipeline
 * seeks by requesting byte ranges, and without 206 responses seeking breaks.
 */

export const MEDIA_SCHEME = 'beachday-media';

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

/** token -> absolute path */
const pathsByToken = new Map();
/** absolute path -> token, so granting the same file twice yields one URL */
const tokensByPath = new Map();

/** Must run before app 'ready' — Electron rejects privileged schemes after it. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        // stream: media elements may consume the response incrementally.
        stream: true,
        supportFetchAPI: true,
        // corsEnabled + Access-Control-Allow-Origin: without CORS, Web Audio
        // treats the media as cross-origin and outputs silence.
        corsEnabled: true,
      },
    },
  ]);
}

/** Allow the renderer to play `filePath`, returning the URL to use for it. */
export function grantMediaUrl(filePath) {
  let token = tokensByPath.get(filePath);
  if (!token) {
    token = randomBytes(12).toString('hex');
    tokensByPath.set(filePath, token);
    pathsByToken.set(token, filePath);
  }
  return `${MEDIA_SCHEME}://track/${token}`;
}

/** URL for an art cache entry returned by cacheArt(). */
export function artUrl(name) {
  return `${MEDIA_SCHEME}://art/${name}`;
}

/** Must run after app 'ready'. */
export function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const { hostname, pathname } = new URL(request.url);
    const name = pathname.slice(1);

    if (hostname === 'track') {
      const filePath = pathsByToken.get(name);
      const extension = filePath && path.extname(filePath).toLowerCase();
      return serveFile(request, filePath, MIME_TYPES[extension]);
    }
    if (hostname === 'art') {
      const filePath = resolveArtPath(name);
      return serveFile(request, filePath, filePath && ART_CONTENT_TYPES[path.extname(filePath).slice(1)]);
    }
    return new Response(null, { status: 404 });
  });
}

async function serveFile(request, filePath, contentType) {
  if (!filePath) return new Response(null, { status: 404 });

  let size;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return new Response(null, { status: 404 });
  }

  const headers = {
    'Content-Type': contentType ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
  };

  if (size === 0) return new Response(null, { status: 200, headers });

  const range = parseRange(request.headers.get('range'), size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      ...(range && { 'Content-Range': `bytes ${start}-${end}/${size}` }),
    },
  });
}

/**
 * Parse a single-range `Range: bytes=...` header.
 * Returns undefined when there is no usable header (serve the whole file),
 * null when the range can't be satisfied (416), or { start, end } inclusive.
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match) return undefined;
  const [, startText, endText] = match;

  if (startText === '') {
    // Suffix range: the last N bytes.
    const length = Number(endText);
    if (!length) return null;
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(startText);
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  if (start >= size || end < start) return null;
  return { start, end };
}
