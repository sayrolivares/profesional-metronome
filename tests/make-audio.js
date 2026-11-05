/* Run: node tests/make-audio.js [dir] — writes the WAV files the browser test feeds to
   Chrome's fake microphone (default tests/fixtures/, 48 kHz mono, 16-bit; not committed). Each file is a sequence of
   plucked notes with known pitches, so the test knows what the tuner should show. */
const fs = require('fs'), path = require('path');
const S = require('./signals.js');
const SR = 48000;
function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}
/* a sustained string note: harmonics with a slow decay, re-plucked every `every` seconds */
function note(freq, seconds, { every = 2.5, amp = 0.5 } = {}) {
  const n = Math.round(seconds * SR), out = new Float32Array(n);
  for (let start = 0; start < n; start += Math.round(every * SR)) {
    const len = Math.min(n - start, Math.round(every * SR));
    const sig = S.harmonics(freq, [1, 0.7, 0.45, 0.3, 0.2, 0.12], { n: len, amp, decay: 1.6, start: 0 });
    for (let i = 0; i < len; i++) out[start + i] += sig[i] * Math.min(1, i / 96);   // 2 ms attack, no click
  }
  return out;
}
const silence = (s) => new Float32Array(Math.round(s * SR));
const join = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Float32Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const cents = (f, c) => f * Math.pow(2, c / 1200);
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'fixtures');
fs.mkdirSync(dir, { recursive: true });
const files = {
  'e2-flat.wav': join(silence(0.3), note(cents(82.407, -12), 30, { every: 3 })),     // low E, 12 ¢ flat
  'a2-intune.wav': join(silence(0.3), note(110, 30, { every: 3 })),                  // A, in tune
  'a4-442.wav': join(silence(0.3), note(442, 30, { every: 3 })),                     // A4 at 442 Hz
  'b0-bass.wav': join(silence(0.3), note(cents(30.868, 8), 30, { every: 3 })),       // 5-string low B, 8 ¢ sharp
  'silence.wav': silence(10),
  /* a real-sounding low E through a phone microphone: inharmonic string, its fundamental
     cut ~25 dB by a 200 Hz low cut, in a room at −60 dBFS; re-plucked every 3 s */
  'e2-phone.wav': (() => { const parts = [silence(0.3)]; for (let k = 0; k < 10; k++) parts.push(S.highpass(S.string(82.4069, { seconds: 3, amp: 0.35, seed: 11 + k }), 200, { order: 4 })); const x = join(...parts); return S.mix(x, S.roomNoise(x.length, -60, 5)); })(),
  /* one A string pluck that dies away quickly into a quiet room, then nothing but the room */
  'a2-decay.wav': (() => { const x = join(silence(0.3), S.string(110, { seconds: 1.6, amp: 0.4, decay: 0.35 }), silence(8)); return S.mix(x, S.roomNoise(x.length, -62, 6)); })(),
};
for (const [name, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), wav(s));
if (require.main === module) console.log('wrote', Object.keys(files).join(', '), 'to', dir);
module.exports = { dir };
