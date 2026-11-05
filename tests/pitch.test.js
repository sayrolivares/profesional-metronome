/* Run: node tests/pitch.test.js — the pitch detector and tracker against synthetic signals:
   pure tones, string-like timbres, missing and weak fundamentals, plucked strings, noise,
   silence, weak signals, vibrato, drift, other sample rates, and a sweep over every note
   from B0 to C8 that fails on any octave error. */
require('../js/notes.js'); require('../js/pitch.js');
const { PitchDetector, PitchTracker } = globalThis.MN.pitch;
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

/* ---------------- tracker ---------------- */
const frame = (f, clarity = 0.98, rms = 0.1, extra = {}) => Object.assign({ freq: f, clarity, rms, candidates: [] }, extra);
const silence = () => ({ freq: null, clarity: 0, rms: 1e-5, candidates: [] });

t('tracker: a steady note gives a steady reading', () => {
  const tr = new PitchTracker();
  let out, now = 0;
  const r = S.rng(11);
  const seen = [];
  for (let i = 0; i < 60; i++) { out = tr.push(frame(110 * Math.pow(2, ((r() - 0.5) * 6) / 1200)), (now += 50)); if (i > 10) seen.push(S.centsOff(out.freq, 110)); }
  assert.equal(out.status, 'pitch'); assert.ok(out.stable);
  const spread = Math.max(...seen) - Math.min(...seen);
  assert.ok(spread < 2.5, '±3 ¢ jitter should be smoothed, spread was ' + spread.toFixed(2));
});
t('tracker: quiet input is gated, then the note fades into a short hold', () => {
  const tr = new PitchTracker();
  assert.equal(tr.push(frame(110, 0.99, 1e-4), 0).status, 'quiet', '−80 dBFS is below the gate');
  for (let i = 1; i < 6; i++) tr.push(frame(110), i * 50);
  const held = tr.push(silence(), 400);
  assert.equal(held.status, 'hold'); within(held.freq, 110, 1);
  assert.equal(tr.push(silence(), 400 + 2000).status, 'quiet', 'hold expires');
});
t('tracker: low-confidence frames are not shown', () => {
  const tr = new PitchTracker();
  for (let i = 0; i < 5; i++) assert.notEqual(tr.push(frame(110, 0.7), i * 50).status, 'pitch');
});
t('tracker: loud but unpitched sound becomes "noisy"', () => {
  const tr = new PitchTracker();
  let s;
  for (let i = 0; i < 25; i++) s = tr.push(frame(200, 0.2, 0.2), i * 50).status;
  assert.equal(s, 'noisy');
});
t('tracker: a stray frame does not move the note; a real change needs confirmation', () => {
  const tr = new PitchTracker();
  let now = 0;
  for (let i = 0; i < 6; i++) tr.push(frame(110), (now += 50));
  within(tr.push(frame(146.83), (now += 50)).freq, 110, 1, 'one stray frame');
  within(tr.push(frame(110), (now += 50)).freq, 110, 1);
  tr.push(frame(146.83), (now += 50));
  const moved = tr.push(frame(146.83), (now += 50));
  within(moved.freq, 146.83, 1, 'after two agreeing frames');
});
t('tracker: octave continuity prefers the period that continues the note', () => {
  const tr = new PitchTracker();
  let now = 0;
  for (let i = 0; i < 6; i++) tr.push(frame(82.41), (now += 50));
  const out = tr.push(frame(164.82, 0.97, 0.1, { candidates: [{ freq: 82.41, clarity: 0.95 }] }), (now += 50));
  within(out.freq, 82.41, 1);
});
t('tracker: the string being tuned resolves an octave ambiguity at the start', () => {
  const tr = new PitchTracker();
  const out = tr.push(frame(82.41, 0.97, 0.1, { candidates: [{ freq: 41.2, clarity: 0.95 }] }), 0, 41.2);
  within(out.freq, 41.2, 1);
  const tr2 = new PitchTracker();
  within(tr2.push(frame(82.41, 0.97, 0.1, { candidates: [{ freq: 41.2, clarity: 0.95 }] }), 0, 0).freq, 82.41, 1, 'no hint: keep the clearest');
});
t('tracker: the attack of a new pluck is skipped', () => {
  const tr = new PitchTracker();
  tr.push(frame(110, 0.99, 0.001), 0);                 // quiet ring
  const hit = tr.push(frame(118, 0.95, 0.3), 50);      // +50 dB jump: attack frame, slightly sharp
  assert.notEqual(hit.status, 'pitch');
  within(tr.push(frame(110, 0.98, 0.25), 100).freq, 110, 1);
});
t('tracker: the noise floor follows a noisy room and raises the gate', () => {
  const tr = new PitchTracker();
  const fan = () => ({ freq: 300, clarity: 0.3, rms: 0.01, candidates: [] });   // −40 dBFS, unpitched
  let out;
  for (let i = 0; i < 400; i++) out = tr.push(fan(), i * 50);
  assert.ok(out.gateDb > -40, 'gate should rise above the fan, is ' + out.gateDb.toFixed(1));
  assert.equal(out.status, 'quiet');
  tr.push(frame(110, 0.98, 0.1), 400 * 50);           // its attack frame is skipped
  assert.equal(tr.push(frame(110, 0.98, 0.1), 401 * 50).status, 'pitch', 'a real note is still heard');
});
t('end to end: detector + tracker on a decaying pluck', () => {
  const tr = new PitchTracker();
  const p = S.pluck(82.41, { n: 48000, damping: 0.998 });
  let last, now = 0;
  for (let start = 0; start + LONG <= p.length; start += 2400) last = tr.push(D.detect(p.subarray(start, start + LONG), SR), (now += 50));
  assert.ok(['pitch', 'hold'].includes(last.status));
  within(last.freq, p.freq, 0.5);
});

console.log(`\n${n} pitch tests passed`);
