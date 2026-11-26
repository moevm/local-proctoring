import { execFileSync } from 'node:child_process';

export function probeMedia(file) {
  return JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file],
      { encoding: 'utf8' },
    ),
  );
}

/** Decode the recorded microphone signal; a silent track still passes ffprobe. */
export function probeAudioRms(file) {
  const samples = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      's16le',
      'pipe:1',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  if (samples.length === 0) throw new Error('Recorded audio contains no samples');
  let sum = 0;
  for (let offset = 0; offset < samples.length; offset += 2) {
    const value = samples.readInt16LE(offset) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / (samples.length / 2));
}
