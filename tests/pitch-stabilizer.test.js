/* Run: node tests/pitch-stabilizer.test.js — confidence (js/pitch-confidence.js) and the
   stabiliser (js/pitch-stabilizer.js) on scripted detector results, so each rule is
   tested on its own: gating, the room's noise floor, confidence and agreement, pluck
   onsets and settling, attack frames, octave continuity, note changes, smoothing that
   follows real changes, decay ("Pluck again") and the noisy state. */
require('../js/pitch-confidence.js'); require('../js/pitch-stabilizer.js');
const { pitchConfidence: C, PitchStabilizer, pitchStabilizer } = globalThis.MN;
const S = require('./signals.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok —', name); };
const within = (f, ref, cents, msg) => { assert.ok(f > 0, (msg || '') + ' no pitch'); const c = S.centsOff(f, ref); assert.ok(Math.abs(c) <= cents, `${msg || ''} ${f.toFixed(3)} Hz is ${c.toFixed(2)} ¢ from ${ref.toFixed(3)} Hz`); };

/* a detector result; rms 0.1 = −20 dBFS */
const frame = (freq, clarity = 0.97, rms = 0.1, extra = {}) => Object.assign({ freq, clarity, clean: Math.max(clarity, 0.98), rms, harmonicity: 0.92, candidates: [] }, extra);
const silence = (rms = 1e-4) => ({ freq: null, clarity: 0, rms, candidates: [] });
/* feed a stabiliser: a few quiet frames (so the noise floor is known), then the frames */
function run(frames, { st = new PitchStabilizer(), t0 = 0, hint = 0, quiet = 6 } = {}) {
  let now = t0; const out = [];
  for (let i = 0; i < quiet; i++) st.push(silence(), (now += 50));
  for (const f of frames) out.push(st.push(f, (now += 50), hint));
  return { st, out, now };
}

/* ---------------- confidence ---------------- */
t('confidence: a clear note well above the room is good; noise is not', () => {
  assert.equal(C.assess({ clarity: 0.97, aboveFloorDb: 30, harmonicity: 0.9 }).quality, 'good');
  const noise = C.assess({ clarity: 0.4, aboveFloorDb: 20, harmonicity: 0.3 });
  assert.equal(noise.score, 0); assert.equal(noise.quality, 'none');
  const buried = C.assess({ clarity: 0.95, aboveFloorDb: 1, harmonicity: 0.9 });
  assert.ok(buried.score < 0.5, 'a clear period barely above the noise floor is not good: ' + buried.score.toFixed(2));
});
t('confidence: each piece of evidence raises the score; agreement raises it most', () => {
  const base = { clarity: 0.7, aboveFloorDb: 10, harmonicity: 0.5 };
  const s0 = C.assess(base).score;
  for (const [k, v] of [['clarity', 0.85], ['aboveFloorDb', 16], ['harmonicity', 0.7]]) assert.ok(C.assess(Object.assign({}, base, { [k]: v })).score > s0, k);
  const agreed = C.assess(Object.assign({}, base, { agree: true }));
  assert.ok(agreed.score > s0 && agreed.base === s0, 'agreement is a bonus on top of the base score');
  assert.ok(C.agrees(110, 110 * Math.pow(2, 15 / 1200)) && !C.agrees(110, 110 * Math.pow(2, 30 / 1200)));
});

/* ---------------- stabiliser ---------------- */
t('a steady note gives a steady reading (±3 ¢ frame jitter → < 2.5 ¢ spread)', () => {
  const r = S.rng(11);
  const { out } = run(Array.from({ length: 60 }, () => frame(110 * Math.pow(2, ((r() - 0.5) * 6) / 1200))));
  const last = out[out.length - 1];
  assert.equal(last.status, 'pitch'); assert.ok(last.stable && last.settled); assert.equal(last.quality, 'good');
  const seen = out.slice(12).map((o) => S.centsOff(o.freq, 110));
  assert.ok(Math.max(...seen) - Math.min(...seen) < 2.5, 'spread ' + (Math.max(...seen) - Math.min(...seen)).toFixed(2));
});
t('quiet input is gated; low-confidence frames alone never show a note', () => {
  const st = new PitchStabilizer();
  assert.equal(st.push(frame(110, 0.99, 1e-4), 0).status, 'quiet', '−80 dBFS is below the gate');
  const { out } = run(Array.from({ length: 8 }, (_, i) => frame(110 * (1 + (i % 3) * 0.04), 0.55)));
  assert.ok(out.every((o) => o.status !== 'pitch'), 'unclear frames that disagree with each other');
});
t('in room noise, weaker frames that agree with each other DO show the note', () => {
  /* clarity 0.7, 12 dB above the floor: not enough on its own, enough when consistent */
  const st = new PitchStabilizer();
  let now = 0;
  for (let i = 0; i < 200; i++) st.push(silence(0.004), (now += 50));      // ten seconds in a room at −48 dBFS
  assert.ok(st.floorDb > -50 && st.floorDb < -46, 'floor learned: ' + st.floorDb.toFixed(1));
  const r = S.rng(5); let o;
  const outs = [];
  for (let i = 0; i < 12; i++) { o = st.push(frame(82.41 * Math.pow(2, ((r() - 0.5) * 8) / 1200), 0.7, 0.016, { harmonicity: 0.6 }), (now += 50)); outs.push(o); }
  assert.equal(o.status, 'pitch'); within(o.freq, 82.41, 3);
  assert.ok(['fair', 'good'].includes(o.quality));
});
t('a pluck: its attack frame is skipped, the reading appears at once, "settled" a moment later', () => {
  const st = new PitchStabilizer();
  run([], { st });
  const hit = st.push(frame(110 * Math.pow(2, 12 / 1200), 0.95, 0.3), 1000);
  assert.ok(hit.onset); assert.notEqual(hit.status, 'pitch', 'attack frame skipped');
  const first = st.push(frame(110 * Math.pow(2, 8 / 1200), 0.97, 0.28), 1050);
  assert.equal(first.status, 'pitch', 'shown on the next frame'); assert.ok(!first.settled);
  let o; for (let now = 1100; now <= 1300; now += 50) o = st.push(frame(110, 0.98, 0.25), now);
  assert.ok(o.settled, 'settled once the attack has passed');
  within(o.freq, 110, 3, 'followed the attack glide down');
});
t('during the attack, only clear and harmonic frames can start a note', () => {
  const st = new PitchStabilizer();
  run([], { st });
  st.push(frame(392, 0.95, 0.3), 1000);                                        // onset (skipped)
  const thump = st.push(frame(98, 0.82, 0.3, { harmonicity: 0.7 }), 1050);    // the body's thump, two octaves low
  assert.notEqual(thump.status, 'pitch');
  const clean = st.push(frame(392, 0.96, 0.28), 1100);
  assert.equal(clean.status, 'pitch'); within(clean.freq, 392, 1);
});
t('a stray frame does not move the note; a different note needs confirmation', () => {
  const { st, now: t0 } = run(Array.from({ length: 8 }, () => frame(110)));
  let now = t0;
  within(st.push(frame(146.83), (now += 50)).freq, 110, 1, 'one stray frame');
  within(st.push(frame(110), (now += 50)).freq, 110, 1);
  st.push(frame(146.83), (now += 50));
  within(st.push(frame(146.83), (now += 50)).freq, 146.83, 1, 'after two agreeing frames');
});
t('a new pluck of a different string switches at once', () => {
  const { st, now: t0 } = run(Array.from({ length: 10 }, (_, i) => frame(110, 0.97, 0.1 * Math.pow(0.8, i))));
  let now = t0;
  st.push(frame(146.83, 0.96, 0.3), (now += 50));             // onset, skipped
  within(st.push(frame(146.83, 0.97, 0.28), (now += 50)).freq, 146.83, 1, 'no confirmation wait after a pluck');
});
t('octave continuity: an established note keeps its octave when frames read an octave up', () => {
  /* late in its decay a low E is mostly 2nd harmonic: the detector says E3, with E2 as a
     candidate */
  const { st, now: t0 } = run(Array.from({ length: 10 }, () => frame(82.41)));
  let now = t0, o;
  for (let i = 0; i < 10; i++) o = st.push(frame(164.82, 0.95, 0.08, { candidates: [{ freq: 82.41, clarity: 0.99, support: 0.0005 }] }), (now += 50));
  within(o.freq, 82.41, 1);
});
t('a young note caught an octave low corrects itself when that octave has no partials of its own', () => {
  const st = new PitchStabilizer();
  run([], { st });
  st.push(frame(220, 0.9, 0.3), 1000);                                                        // onset
  for (let now = 1050; now <= 1150; now += 50) st.push(frame(220, 0.96, 0.3, { harmonicity: 0.95 }), now);
  /* pretend the first lock was the octave below (as a bad attack frame could cause) */
  st.cents = pitchStabilizer.centsOf(220); st.cents -= 1200; st.frames = 1;
  let o;
  for (let now = 1200; now <= 1400; now += 50) o = st.push(frame(220, 0.97, 0.25, { candidates: [{ freq: 110, clarity: 0.99, support: 0.0001 }] }), now);
  within(o.freq, 220, 1, 'back to A3');
});
t('the string being tuned, or the instrument range, settles an octave question at the start', () => {
  const amb = frame(82.41, 0.97, 0.1, { candidates: [{ freq: 41.2, clarity: 0.99 }] });
  within(run([amb, amb], { hint: 41.2 }).out[1].freq, 41.2, 1, 'hint: the bass low E');
  within(run([amb, amb]).out[1].freq, 82.41, 1, 'no hint: the detector’s choice');
  const st = new PitchStabilizer(); st.setRange(82, 1320);
  const low = frame(41.2, 0.97, 0.1, { candidates: [{ freq: 82.41, clarity: 0.99 }] });
  within(run([low, low], { st }).out[1].freq, 82.41, 1, 'guitar: nothing below E2');
});
t('smoothing follows a real change (a peg being turned): never more than 4 ¢ behind', () => {
  const { st, now: t0 } = run(Array.from({ length: 10 }, () => frame(110)));
  let now = t0, worst = 0;
  for (let i = 1; i <= 40; i++) {           // 30 ¢ up over two seconds, then hold
    const truth = 110 * Math.pow(2, Math.min(30, i * 1.5) / 1200);
    const o = st.push(frame(truth), (now += 50));
    if (i > 3) worst = Math.max(worst, Math.abs(S.centsOff(o.freq, truth)));
  }
  assert.ok(worst < 4, 'lag ' + worst.toFixed(2) + ' ¢');
});
t('decay: sunk near the room (or far below the pluck), or no trustworthy frame → "decay" with the last reading, then nothing', () => {
  const { st, now: t0 } = run(Array.from({ length: 10 }, () => frame(110, 0.98, 0.3)));
  let now = t0;
  /* the string has sunk to a few dB above the room: still periodic, but noise now pulls
     the reading around (here 1 ¢ off); it is not reported */
  const faded = st.push(frame(109.4, 0.95, 2.5e-4), (now += 50));
  assert.equal(faded.status, 'decay'); within(faded.freq, 110, 0.5, 'the last good reading, not the drift');
  /* a quiet note that is NOT decaying (at its own peak) is still read near the floor */
  const quietRoom = new PitchStabilizer({ gateDb: -70 });
  for (let i = 0; i < 10; i++) quietRoom.push(silence(5e-4), i * 50);               // room at −66 dBFS
  let q; for (let i = 10; i < 18; i++) q = quietRoom.push(frame(146.83, 0.97, 1e-3), i * 50);   // note at −60
  assert.equal(q.status, 'pitch', 'a soft note only 6 dB above the room, at its own peak, is read');
  for (let i = 0; i < 20; i++) st.push(silence(), (now += 50));
  assert.equal(st.push(silence(), (now += 50)).status, 'decay', 'still shown for a while');
  now += pitchStabilizer.DEFAULTS.decayShowMs;
  assert.equal(st.push(silence(), (now += 50)).status, 'quiet', 'then cleared');
  /* untrustworthy frames: decay after ~200 ms */
  const b = run(Array.from({ length: 10 }, () => frame(196, 0.98, 0.2)));
  let s2 = b.now, o;
  for (let i = 0; i < 6; i++) o = b.st.push(frame(250, 0.3, 0.2), (s2 += 50));
  assert.equal(o.status, 'decay');
});
t('loud but never trustworthy sound becomes "noisy"; the floor follows a noisy room', () => {
  const st = new PitchStabilizer();
  let s;
  for (let i = 0; i < 25; i++) s = st.push(frame(200, 0.2, 0.2), i * 50).status;
  assert.equal(s, 'noisy');
  const room = new PitchStabilizer();
  let o;
  for (let i = 0; i < 400; i++) o = room.push({ freq: 300, clarity: 0.3, rms: 0.01, candidates: [] }, i * 50);   // a fan at −40 dBFS
  assert.ok(o.gateDb > -40, 'gate above the fan: ' + o.gateDb.toFixed(1));
  room.push(frame(110, 0.98, 0.1), 400 * 50);
  assert.equal(room.push(frame(110, 0.98, 0.1), 401 * 50).status, 'pitch', 'a real note is still heard');
});

console.log(`\n${n} stabiliser and confidence tests passed`);
