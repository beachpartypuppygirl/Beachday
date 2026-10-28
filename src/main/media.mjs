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
 *   beachday-media://track/<token>   audio the user has chosen: a file, or a
 *                                    byte range inside a bundled .bday
 *   beachday-media://art/<name>      an image in the art cache (art.mjs)
 *
 * Main hands out an opaque URL per audio source, and the handler serves only
 * those. The renderer can't construct a URL for an arbitrary path, and Windows
 * paths (drive letters, backslashes) never have to survive URL encoding.
 *
 * A source is { path, offset?, size?, name? }. offset/size select a stored
 * entry inside a .bday (bday.mjs); name supplies the extension for the
 * content type when path is the .bday itself.
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

/** token -> source */
const sourcesByToken = new Map();
/** source key -> token, so granting the same source twice yields one URL */
const tokensByKey = new Map();

const sourceKey = ({ path: filePath, offset = 0 }) => `${filePath}\0${offset}`;
const tokenOf = (url) => url?.startsWith(`${MEDIA_SCHEME}://track/`) ? url.slice(`${MEDIA_SCHEME}://track/`.length) : null;

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

/** Allow the renderer to play `source`, returning the URL to use for it. */
export function grantMediaSource(source) {
  const key = sourceKey(source);
  let token = tokensByKey.get(key);
  if (!token) {
    token = randomBytes(12).toString('hex');
    tokensByKey.set(key, token);
    sourcesByToken.set(token, source);
  }
  return `${MEDIA_SCHEME}://track/${token}`;
}

/** The source behind a URL this module granted, or null. Main uses it to save. */
export function sourceForUrl(url) {
  return sourcesByToken.get(tokenOf(url)) ?? null;
}

/**
 * Point an existing URL at a new source. Used after re-saving a bundled
 * .bday: entry offsets change, but an <audio> element mid-playback keeps
 * requesting ranges from the URL it already has.
 */
export function repointMediaUrl(url, source) {
  const token = tokenOf(url);
  const previous = sourcesByToken.get(token);
  if (!previous) return;
  tokensByKey.delete(sourceKey(previous));
  tokensByKey.set(sourceKey(source), token);
  sourcesByToken.set(token, source);
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
      const source = sourcesByToken.get(name);
      const extension = source && path.extname(source.name ?? source.path).toLowerCase();
      return serveFile(request, source, MIME_TYPES[extension]);
    }
    if (hostname === 'art') {
      const filePath = resolveArtPath(name);
      return serveFile(
        request,
        filePath && { path: filePath },
        filePath && ART_CONTENT_TYPES[path.extname(filePath).slice(1)]
      );
    }
    return new Response(null, { status: 404 });
  });
}

async function serveFile(request, source, contentType) {
  if (!source) return new Response(null, { status: 404 });
  const { path: filePath, offset = 0 } = source;

  let size = source.size;
  try {
    const info = await stat(filePath);
    size ??= info.size;
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
  const body = Readable.toWeb(
    fs.createReadStream(filePath, { start: offset + start, end: offset + end })
  );
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
