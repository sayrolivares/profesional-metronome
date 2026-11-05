/* Run: node tests/pitch.test.js — the pitch DETECTOR (js/pitch.js), one frame at a time,
   against synthetic signals: pure tones, string-like timbres, missing and weak
   fundamentals, plucked strings, noise, silence, weak signals, vibrato, drift, other sample
   rates, a sweep over every note from B0 to C8 that fails on any octave error, the six
   guitar strings as realistic inharmonic plucks, a phone microphone's low cut, and the
   noise-floor removal and harmonic checks. The stabiliser has its own tests
   (tests/pitch-stabilizer.test.js); whole tuning scenarios are in
   tests/tuning-scenarios.test.js; real recordings in tests/recordings.test.js. */
require('../js/notes.js'); require('../js/pitch.js');
const { PitchDetector } = globalThis.MN.pitch;
const S = require('./signals.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok —', name); };
const SR = 48000, LONG = 8192, SHORT = 4096;
const D = new PitchDetector();
const within = (f, ref, cents, msg) => { assert.ok(f > 0, (msg || '') + ' no pitch found'); const c = S.centsOff(f, ref); assert.ok(Math.abs(c) <= cents, `${msg || ''} ${f.toFixed(3)} Hz is ${c.toFixed(2)} ¢ from ${ref.toFixed(3)} Hz (limit ${cents} ¢)`); };

t('pure sine waves from B0 to C8 within 0.1 ¢', () => {
  for (const m of [23, 28, 33, 40, 45, 50, 55, 59, 64, 69, 76, 81, 88, 93, 100, 105, 108]) {
    const f = S.midiFreq(m);
    const r = D.detect(S.sine(f, { n: m < 45 ? LONG : SHORT }), SR);
    within(r.freq, f, 0.1, 'midi ' + m);
    assert.ok(r.clarity > 0.99);
  }
});
t('string-like timbre (12 harmonics) within 1 ¢', () => {
  for (const m of [23, 28, 40, 45, 52, 57, 64, 69, 76, 88, 100]) {
    const f = S.midiFreq(m);
    within(D.detect(S.saw(f), SR).freq, f, 1, 'midi ' + m);
  }
});
t('missing fundamental: E2 from its harmonics alone', () => {
  within(D.detect(S.harmonics(82.41, [0, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2]), SR).freq, 82.41, 0.5);
});
t('weak fundamental with a dominant 2nd harmonic is not read an octave up', () => {
  within(D.detect(S.harmonics(82.41, [0.15, 1, 0.3, 0.2, 0.1]), SR).freq, 82.41, 0.5, 'E2');
  within(D.detect(S.harmonics(41.2, [0.05, 1, 0.6, 0.4, 0.2]), SR).freq, 41.2, 0.5, 'E1, phone-mic roll-off');
  within(D.detect(S.harmonics(30.87, [0.1, 1, 0.7, 0.5, 0.3]), SR).freq, 30.87, 0.5, 'B0');
});
t('strong upper harmonics are not read as the pitch (no octave-up / twelfth errors)', () => {
  within(D.detect(S.harmonics(110, [0.3, 0.2, 1, 0.1, 0.4]), SR).freq, 110, 0.5, 'dominant 3rd harmonic');
  within(D.detect(S.harmonics(196, [0.4, 0.2, 0.2, 1, 0.3, 0.5]), SR).freq, 196, 0.5, 'dominant 4th harmonic');
});
t('plucked strings (Karplus–Strong) within 0.1 ¢ of their exact pitch', () => {
  for (const f of [30.87, 41.2, 55, 82.41, 110, 146.83, 196, 246.94, 329.63, 440, 659.25, 1318.5]) {
    const p = S.pluck(f);
    within(D.detect(p, SR).freq, p.freq, 0.1, 'pluck ' + f);
  }
});
t('decaying note keeps its pitch', () => {
  within(D.detect(S.harmonics(98, [1, 0.6, 0.4, 0.3], { decay: 0.6 }), SR).freq, 98, 0.5, 'ringing string');
  /* extreme: the note falls to 12% within one analysis window (a hard staccato) */
  within(D.detect(S.harmonics(98, [1, 0.6, 0.4, 0.3], { decay: 0.08 }), SR).freq, 98, 2, 'staccato');
});
t('noise at 10 dB SNR: still found, within 6 ¢ in a single frame', () => {
  for (const [f, seed] of [[110, 3], [220, 4], [82.41, 9]]) {
    const r = D.detect(S.addNoise(S.saw(f), 10, seed), SR);
    within(r.freq, f, 6, f + ' Hz');
  }
});
t('pure noise, very noisy notes and silence are not confident readings', () => {
  for (const seed of [1, 2, 3, 4, 5]) assert.ok(D.detect(S.noise(LONG, 0.3, seed), SR).clarity < 0.5, 'noise seed ' + seed);
  assert.ok(D.detect(S.addNoise(S.saw(110), -3), SR).clarity < 0.8, 'note buried 3 dB under noise');
  const silent = D.detect(new Float32Array(LONG), SR);
  assert.equal(silent.freq, null); assert.equal(silent.rms, 0);
  assert.equal(D.detect(new Float32Array(100), SR).freq, null, 'too short');
});
t('linear drift and DC offset do not hide the pitch', () => {
  const sig = S.saw(110);
  for (let i = 0; i < sig.length; i++) sig[i] += 0.4 - 1.2 * (i / sig.length);
  within(D.detect(sig, SR).freq, 110, 0.5);
});
t('vibrato ±20 ¢ reads near the centre pitch', () => {
  within(D.detect(S.harmonics(440, [1, 0.5, 0.3], { vibrato: { cents: 20, rate: 5 } }), SR).freq, 440, 8);
});
t('works at 44.1 kHz and 96 kHz', () => {
  within(D.detect(S.saw(82.41, { sr: 44100 }), 44100).freq, 82.41, 0.5, '44.1 kHz');
  within(D.detect(S.saw(41.2, { sr: 96000, n: 16384 }), 96000).freq, 41.2, 0.5, '96 kHz');
});
t('no octave errors on any note from B0 to C8 (string timbre and weak fundamental)', () => {
  const errors = [];
  for (let m = 23; m <= 108; m++) {
    const f = S.midiFreq(m), size = f < 160 ? LONG : SHORT;
    for (const [kind, sig] of [['saw', S.saw(f, { n: size })], ['weak', S.harmonics(f, [0.2, 1, 0.5, 0.3, 0.2], { n: size })]]) {
      const r = D.detect(sig, SR);
      const c = r.freq ? S.centsOff(r.freq, f) : NaN;
      if (!(Math.abs(c) < 5)) errors.push(`${kind} midi ${m}: ${r.freq ? r.freq.toFixed(2) : 'none'} (${Number.isFinite(c) ? c.toFixed(0) : '–'} ¢)`);
    }
  }
  assert.deepEqual(errors, []);
});
t('detection cost stays small (8192 samples)', () => {
  const sig = S.saw(110);
  for (let i = 0; i < 20; i++) D.detect(sig, SR);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) D.detect(sig, SR);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
  console.log(`   ${ms.toFixed(2)} ms per frame`);
  assert.ok(ms < 15, 'too slow: ' + ms);
});

/* ---------------- the six guitar strings, realistic plucks ---------------- */
const SIX = [['E2', 82.4069], ['A2', 110], ['D3', 146.832], ['G3', 195.998], ['B3', 246.942], ['E4', 329.628]];
const frames = (sig, size = LONG, from = 0.3, to = 2.5, hop = 2400) => { const out = []; for (let end = Math.round(from * SR); end <= Math.min(sig.length, to * SR); end += hop) out.push(sig.subarray(end - size, end)); return out; };

t('six strings, clean inharmonic plucks: every sustain frame within 1 ¢', () => {
  for (const [name, f] of SIX) {
    const sig = S.string(f, { seconds: 2.6, glide: 0 });
    for (const buf of frames(sig)) within(D.detect(buf, SR).freq, f, 1, name);
  }
});
t('six strings through a phone microphone (low cut at 200 Hz, 24 dB/octave): no octave errors', () => {
  for (const [name, f] of SIX) {
    /* a perfectly harmonic string: exact even with its fundamental cut */
    for (const buf of frames(S.highpass(S.string(f, { seconds: 2.6, glide: 0, B: 0 }), 200, { order: 4 }))) within(D.detect(buf, SR).freq, f, 0.5, name + ' (phone, harmonic)');
    /* a real, slightly inharmonic string: with the fundamental cut, the pitch is carried by
       upper partials, which are a little sharp (B = 1e-4: the 6th is 3 ¢ high). Every
       tuner that hears through such a microphone sees this; here it stays under 4 ¢. */
    for (const buf of frames(S.highpass(S.string(f, { seconds: 2.6, glide: 0 }), 200, { order: 4 }))) within(D.detect(buf, SR).freq, f, 4, name + ' (phone)');
  }
});
t('octave-down check: a low E whose odd partials are weak is still E2, not E3', () => {
  /* fundamental almost gone, 2nd harmonic dominant, odd partials about 4 % of the energy:
     the plain MPM rule (first peak within 90 % of the highest) reads E3 here */
  const sig = S.harmonics(82.4069, [0.03, 1, 0.22, 0.5, 0.1, 0.3]);
  within(D.detect(sig, SR).freq, 82.4069, 0.5, 'with the check');
  within(new PitchDetector({ downRatio: 0 }).detect(sig, SR).freq, 164.81, 0.5, 'without it, an octave up (documents why it exists)');
  /* …and a real E3 is never pulled down to E2 */
  for (const seed of [1, 2, 3]) within(D.detect(S.addNoise(S.harmonics(164.81, [1, 0.5, 0.3, 0.2, 0.1]), 15, seed), SR).freq, 164.81, 6, 'E3 in noise (an octave would be 1200 ¢)');
});
t('noise-floor removal: in room noise the period is still right even when clarity is low', () => {
  /* 6 dB above a room noise that shares the band: clarity falls (it should: confidence is
     the stabiliser's job), the period does not */
  let right = 0, total = 0, clar = 0;
  for (const [name, f] of SIX) {
    const clean = S.highpass(S.string(f, { seconds: 2.6, amp: 0.2 }), 150, { order: 4 });
    const noisy = S.mix(clean, S.roomNoise(clean.length, S.dbfs(clean.subarray(0.3 * SR, 1.2 * SR)) - 6, 7));
    for (const buf of frames(noisy, LONG, 0.3, 1.2)) { const r = D.detect(buf, SR); total++; clar += r.clarity; if (r.freq && Math.abs(S.centsOff(r.freq, f)) < 20) right++; }
  }
  assert.ok(right / total > 0.9, `period right in ${(100 * right / total).toFixed(0)} % of frames`);
  assert.ok(clar / total < 0.85, 'clarity reflects the noise, mean ' + (clar / total).toFixed(2));
  const off = new PitchDetector({ denoise: false });
  let rightOff = 0;
  for (const [name, f] of SIX) {
    const clean = S.highpass(S.string(f, { seconds: 2.6, amp: 0.2 }), 150, { order: 4 });
    const noisy = S.mix(clean, S.roomNoise(clean.length, S.dbfs(clean.subarray(0.3 * SR, 1.2 * SR)) - 6, 7));
    for (const buf of frames(noisy, LONG, 0.3, 1.2)) { const r = off.detect(buf, SR); if (r.freq && Math.abs(S.centsOff(r.freq, f)) < 20) rightOff++; }
  }
  assert.ok(right >= rightOff, `removal never worse (${right} vs ${rightOff} frames)`);
});
t('output fields: clarity, cleaned clarity, signal-to-noise, harmonicity, candidate support', () => {
  const r = D.detect(S.saw(110), SR);
  assert.ok(r.clarity > 0.95 && r.clean > 0.95);
  assert.ok(r.harmonicity > 0.9, 'a harmonic note: ' + r.harmonicity.toFixed(2));
  assert.ok(r.snrDb > 10);
  const below = r.candidates.find((c) => Math.abs(S.centsOff(c.freq, 55)) < 10);
  assert.ok(below && below.support !== null && below.support < 0.005, 'the octave below has no partials of its own');
  const n = D.detect(S.noise(LONG, 0.3, 9), SR);
  assert.ok(!(n.harmonicity > 0.6) || n.clarity < 0.5, 'noise is neither clear nor harmonic');
});
t('YIN (benchmark path) runs on the same difference function', () => {
  const y = new PitchDetector({ method: 'yin', denoise: false });
  within(y.detect(S.saw(196), SR).freq, 196, 1, 'YIN');
});

console.log(`\n${n} pitch detector tests passed`);
