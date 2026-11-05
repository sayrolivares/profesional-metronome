/* Run: node tests/tuning-scenarios.test.js — the whole tuning chain, frame by frame exactly
   as the app runs it (50 ms frames, the last ~170 ms of audio, detector → confidence and
   stabiliser → note matching), on the six strings of a guitar in standard tuning:

     E2 82.4069 Hz   A2 110 Hz   D3 146.832 Hz   G3 195.998 Hz   B3 246.942 Hz   E4 329.628 Hz

   The strings are synthesised as real strings behave (tests/signals.js `string`): slightly
   inharmonic partials, a plucking position, upper partials dying first, an attack that
   starts sharp, pick noise. Scenarios: clean plucks; a weak fundamental under stronger
   harmonics (a phone microphone's low cut); soft, normal and hard plucks; attack versus
   sustain; decay; background noise; octave traps; strings slightly sharp and flat, with
   each tolerance. Real recordings are in tests/recordings.test.js. */
for (const f of ['notes', 'pitch', 'pitch-confidence', 'pitch-stabilizer', 'tunings', 'tuner-store', 'tuner-model']) require(`../js/${f}.js`);
const { pitch, PitchStabilizer, TunerModel, tunings: T, tunerSettings } = globalThis.MN;
const S = require('./signals.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok —', name); };
const SR = 48000, HOP = 2400, WIN = 8192;
const SIX = [['E2', 82.4069], ['A2', 110], ['D3', 146.832], ['G3', 195.998], ['B3', 246.942], ['E4', 329.628]];
const guitar = T.preset('guitar-standard');
const settings = (patch) => Object.assign({}, tunerSettings.DEFAULTS, patch);
const cents = (f, ref) => 1200 * Math.log2(f / ref);

/* Run the chain over a signal. lead: seconds of the room before the pluck.
   Returns one record per frame: { t (ms from the pluck), r (stabiliser), m (model) }. */
function tune(sig, { s = settings(), lead = 0.5, room = -90, seed = 3 } = {}) {
  const pre = Math.round(lead * SR), x = new Float32Array(pre + sig.length);
  x.set(sig, pre);
  const noisy = S.mix(x, S.roomNoise(x.length, room, seed));
  const det = new pitch.PitchDetector(), st = new PitchStabilizer(), model = new TunerModel();
  st.setRange(82.41, 329.63 * 4);
  const out = [];
  for (let end = HOP; end <= noisy.length; end += HOP) {
    const buf = new Float32Array(WIN), s0 = Math.max(0, end - WIN);
    buf.set(noisy.subarray(s0, end), WIN - (end - s0));
    const now = (end / SR) * 1000;
    const r = st.push(det.detect(buf, SR), now, 0);
    out.push({ t: ((end - pre) / SR) * 1000, r, m: model.update(r, s, guitar, now, true) });
  }
  return out;
}
const shown = (f) => f.m.hasPitch && !f.m.faded;
/* the summary every scenario checks */
function check(frames, truth, name, { maxFirst = 300, cents: tol = 1.5, from = 600, to = Infinity, coverage = 0.9 } = {}) {
  const first = frames.find((f) => f.t > 0 && shown(f));
  assert.ok(first, name + ': never shown');
  assert.ok(first.t <= maxFirst, `${name}: first reading after ${first.t.toFixed(0)} ms`);
  const wrong = frames.filter((f) => f.t > 0 && shown(f) && Math.abs(cents(f.m.freq, truth)) > 50);
  assert.equal(wrong.length, 0, `${name}: ${wrong.length} frames on a wrong note, e.g. ${wrong[0] && cents(wrong[0].m.freq, truth).toFixed(0)} ¢`);
  const span = frames.filter((f) => f.t >= from && f.t <= to);
  const good = span.filter((f) => shown(f) && Math.abs(cents(f.m.freq, truth)) <= tol);
  assert.ok(good.length >= coverage * span.length, `${name}: within ${tol} ¢ in ${good.length}/${span.length} frames`);
  return { first: first.t, frames };
}

t('clean plucks: each string shown within 300 ms, then within 1.5 ¢, named and matched to its string', () => {
  SIX.forEach(([name, f], i) => {
    const fr = tune(S.string(f, { seconds: 3 }));
    check(fr, f, name);
    const late = fr.filter((x) => x.t > 800 && shown(x));
    assert.ok(late.every((x) => x.m.note.text === name), name + ' note name');
    assert.ok(late.every((x) => x.m.stringIndex === i), name + ' string');
    assert.ok(late.some((x) => x.m.inTune), name + ' in tune');
  });
});
t('weak fundamental under stronger harmonics (phone microphone, low cut at 200 Hz): right octave', () => {
  for (const [name, f] of SIX) {
    /* the 2nd harmonic dominant even before the microphone: plucked near the middle… no,
       near a fifth of the length, then the low cut takes the fundamental 15–30 dB down */
    const sig = S.highpass(S.string(f, { seconds: 3, amp: 0.3, weights: [0.4, 1.2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }), 200, { order: 4 });
    check(tune(sig, { room: -70 }), f, name + ' (phone)', { cents: 4 });   // ≤ 4 ¢: inharmonic upper partials carry the pitch (tests/pitch.test.js)
  }
});
t('soft, normal and hard plucks (−45 to −6 dBFS peak) in a quiet room', () => {
  for (const [name, f] of SIX) for (const amp of [0.006, 0.08, 0.6]) {
    check(tune(S.string(f, { seconds: 3, amp }), { room: -72 }), f, `${name} at ${(20 * Math.log10(amp)).toFixed(0)} dB`, { to: 2000 });
  }
});
t('attack versus sustain: the sharp attack is followed, "in tune" waits for the settle', () => {
  for (const [name, f] of SIX) {
    const fr = tune(S.string(f, { seconds: 3, glide: 15, glideMs: 80 }));
    check(fr, f, name, { from: 500 });
    const early = fr.filter((x) => x.t > 0 && x.t < 200 && shown(x));
    assert.ok(early.every((x) => !x.m.inTune), name + ': not "in tune" while the attack is 15 ¢ sharp');
    const settledAt = fr.find((x) => x.t > 0 && x.m.inTune);
    assert.ok(settledAt && settledAt.t <= 600, `${name}: in tune by ${settledAt && settledAt.t.toFixed(0)} ms`);
  }
});
t('decay: as the string dies into the room, "Pluck again" replaces the reading, never a wrong note', () => {
  for (const [name, f] of SIX) {
    const fr = tune(S.string(f, { seconds: 6, amp: 0.3, decay: 0.8 }), { room: -60 });
    check(fr, f, name, { to: 900 });
    const fade = fr.find((x) => x.t > 0 && x.r.status === 'decay');
    assert.ok(fade, name + ': no "Pluck again"');
    assert.equal(fade.m.faded, true);
    /* the last reading kept: within 3 ¢ (in the last dB above the room, noise starts to
       pull a reading by a cent or two; below 8 dB the tuner stops reporting) */
    assert.ok(Math.abs(cents(fade.m.freq, f)) < 3, name + ': the faded reading is the last good one: ' + cents(fade.m.freq, f).toFixed(2));
    const after = fr.filter((x) => x.t > fade.t && x.r.status === 'pitch');
    assert.equal(after.length, 0, name + ': nothing re-read from the fading string');
  }
});
t('background noise: room noise only 12 dB under the note — within 3 ¢ while it lasts, no wrong notes', () => {
  for (const [name, f] of SIX) {
    const sig = S.highpass(S.string(f, { seconds: 3, amp: 0.2, decay: 4 }), 120, { order: 2 });
    const room = S.dbfs(sig.subarray(0, SR)) - 12;
    const fr = tune(sig, { room, seed: 9 });
    check(fr, f, name + ' in noise', { cents: 3, to: 1500, coverage: 0.85 });
    /* as the note sinks toward the room: "Pluck again", not a wandering reading */
    const late = fr.filter((x) => x.t > 1500 && shown(x));
    assert.ok(late.every((x) => Math.abs(cents(x.m.freq, f)) <= 4), name + ': no wandering as it fades');
  }
});
t('pure room noise, hum-like rumble and silence never show a note', () => {
  for (const [label, sig] of [['room', S.roomNoise(3 * SR, -40, 4)], ['silence', new Float32Array(3 * SR)], ['white', S.noise(3 * SR, 0.1, 6)]]) {
    const fr = tune(sig, { room: -95 });
    assert.ok(fr.every((x) => !x.m.hasPitch), label);
  }
});
t('octave traps: dominant 2nd harmonic late in the decay, and a low thump on the attack', () => {
  /* E2 whose odd partials die fast: by the end it is almost all 2nd harmonic */
  const fr = tune(S.string(82.4069, { seconds: 4, amp: 0.4, decay: 6, weights: [0.6, 1.4, 0.5, 1, 0.4, 0.8, 0.3, 0.6] }));
  check(fr, 82.4069, 'E2 late decay', { to: 3800 });
  /* every string with a thump on the pluck: a short burst of low rumble, as loud as the note */
  for (const [name, f] of SIX) {
    const sig = S.string(f, { seconds: 3, amp: 0.4 });
    const thump = S.highpass(S.roomNoise(0.15 * SR, -12, 17), 30);
    for (let i = 0; i < thump.length; i++) sig[i] += thump[i] * Math.exp(-i / (0.025 * SR));
    check(tune(sig), f, name + ' with a thump');
  }
});
t('strings slightly sharp and flat: the reading, the direction and every tolerance', () => {
  for (const [name, f] of SIX) for (const c of [-30, -10, -4, 4, 10, 30]) {
    const truth = f * Math.pow(2, c / 1200);
    const fr = tune(S.string(truth, { seconds: 2 }));
    check(fr, truth, `${name} ${c > 0 ? '+' : ''}${c} ¢`);
    const late = fr.filter((x) => x.t > 700 && shown(x));
    assert.ok(late.every((x) => Math.abs(x.m.cents - c) < 1.5), `${name} ${c}: cents shown`);
    assert.ok(late.every((x) => x.m.direction === (c < 0 ? 'up' : 'down')), `${name} ${c}: direction`);
  }
  /* tolerance ±1, ±2, ±5, ±10 against a string 4 ¢ flat */
  const truth = 110 * Math.pow(2, -4 / 1200), sig = S.string(truth, { seconds: 2 });
  for (const [tol, expect] of [[1, false], [2, false], [5, true], [10, true]]) {
    const late = tune(sig, { s: settings({ tolerance: tol }) }).filter((x) => x.t > 700 && shown(x));
    assert.ok(late.every((x) => x.m.inTune === expect), `±${tol} ¢: in tune ${expect}`);
  }
});
t('responsiveness: turning a peg is followed, not frozen', () => {
  /* A2 gliding from 25 ¢ flat to in tune over a second, while ringing */
  const n = 3 * SR, sig = new Float32Array(n);
  let ph = 0;
  const truthAt = (i) => 110 * Math.pow(2, (-25 + 25 * Math.min(1, Math.max(0, (i / SR - 0.8) / 1))) / 1200);
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * truthAt(i)) / SR;
    let v = 0; for (let k = 1; k <= 8; k++) v += Math.sin(k * ph) / (k * k);
    sig[i] = 0.3 * v * Math.exp(-i / SR / 4);
  }
  const fr = tune(sig);
  const during = fr.filter((x) => x.t > 900 && x.t < 1800 && shown(x));
  const worst = Math.max(...during.map((x) => Math.abs(cents(x.m.freq, truthAt(Math.round(x.t / 1000 * SR) + 0)))));
  assert.ok(worst < 6, 'behind by at most ' + worst.toFixed(1) + ' ¢ (the window itself is 170 ms)');
  const end = fr.filter((x) => x.t > 2200 && shown(x));
  assert.ok(end.every((x) => Math.abs(x.m.cents) < 1) && end.some((x) => x.m.inTune));
});

console.log(`\n${n} tuning scenario tests passed`);
