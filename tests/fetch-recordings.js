/* Run: node tests/fetch-recordings.js — downloads the real instrument recordings that
   tests/recordings.test.js uses, into tests/fixtures/recordings/ (not committed).

   Source: the sample packs of the tonejs-instruments project on npm (MIT-licensed):
   acoustic, electric and nylon guitar, electric bass, cello, double bass and violin; 165
   single notes, plucked or bowed, recorded from real instruments. They are fetched with
   `npm pack` (no install scripts run) and decoded with ffmpeg to 48 kHz mono 32-bit
   float, the format the tuner sees from a microphone.

   Needs: npm with network access, `tar`, and ffmpeg on the PATH. */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const PACKS = ['guitar-acoustic', 'guitar-electric', 'guitar-nylon', 'bass-electric', 'cello', 'contrabass', 'violin'];
const out = path.join(__dirname, 'fixtures', 'recordings');
const tmp = path.join(out, '.download');
fs.mkdirSync(tmp, { recursive: true });
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts)).toString();
try { run('ffmpeg', ['-version']); } catch (e) { console.error('ffmpeg is needed to decode the recordings (https://ffmpeg.org).'); process.exit(1); }

let count = 0;
for (const p of PACKS) {
  const pkg = `tonejs-instrument-${p}-mp3`;
  const dir = path.join(tmp, p);
  if (!fs.existsSync(dir)) {
    const tgz = run('npm', ['pack', pkg, '--silent', '--pack-destination', tmp]).trim().split('\n').pop();
    fs.mkdirSync(dir, { recursive: true });
    run('tar', ['-xzf', path.join(tmp, tgz), '-C', dir]);
  }
  const files = fs.readdirSync(path.join(dir, 'package')).filter((f) => f.endsWith('.mp3'));
  for (const f of files) {
    const name = `${p}.${f.replace(/\.mp3$/, '').replace(/\s+/g, '_')}.f32`;
    const dest = path.join(out, name);
    if (!fs.existsSync(dest)) run('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'package', f), '-ac', '1', '-ar', '48000', '-f', 'f32le', dest]);
    count++;
  }
  console.log(`${pkg}: ${files.length} notes`);
}
fs.writeFileSync(path.join(out, 'SOURCE.txt'), 'Recordings from the tonejs-instruments sample packs (npm: tonejs-instrument-*-mp3, MIT licence),\ndecoded to 48 kHz mono float32 by tests/fetch-recordings.js. Not redistributed with the app.\n');
console.log(`${count} recordings in ${path.relative(process.cwd(), out)}`);
