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
