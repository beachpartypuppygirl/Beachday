import path from 'node:path';

/** Formats Beachday plays. Chromium decodes all of these natively. */
export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'aac'];

export const isAudioFile = (filePath) =>
  AUDIO_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase());
