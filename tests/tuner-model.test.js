/* Run: node tests/tuner-model.test.js — what the tuner shows for a reading: targets,
   cents, tolerance and its hysteresis, settling and faded readings, auto and manual
   strings, custom frequency, reference pitch, string progress and the session history. */
require('../js/notes.js'); require('../js/tunings.js'); require('../js/tuner-store.js'); require('../js/tuner-model.js');
const { notes: N, tunings: T, TunerModel, tunerSettings } = globalThis.MN;
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok —', name); };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);
const S = (patch) => Object.assign({}, tunerSettings.DEFAULTS, patch);
const read = (freq, status = 'pitch') => ({ status, freq, clarity: 0.98, db: -20, stable: true });
const guitar = T.preset('guitar-standard'), chromatic = T.preset('chromatic'), uke = T.preset('ukulele-standard');
const off = (f, c) => f * Math.pow(2, c / 1200);

t('idle and quiet states carry no pitch', () => {
  const m = new TunerModel();
  const idle = m.update(null, S(), guitar, 0, false);
  assert.equal(idle.status, 'idle'); assert.ok(!idle.hasPitch);
  const quiet = m.update({ status: 'quiet', freq: null, clarity: 0, db: -70 }, S(), guitar, 0, true);
  assert.equal(quiet.status, 'quiet'); assert.ok(!quiet.hasPitch);
});
t('chromatic: nearest note, cents and direction', () => {
  const m = new TunerModel();
  const r = m.update(read(off(440, -12)), S({ tuningId: 'chromatic' }), chromatic, 0);
  assert.equal(r.note.text, 'A4'); near(r.cents, -12, 1e-6);
  assert.equal(r.direction, 'up', 'flat → tune up'); assert.ok(!r.inTune);
  assert.equal(r.target.kind, 'note'); near(r.target.freq, 440, 1e-9);
  near(r.deltaHz, off(440, -12) - 440, 1e-9);
  const sharp = new TunerModel().update(read(off(440, 9)), S(), chromatic, 0);
  assert.equal(sharp.direction, 'down');
});
t('tolerance decides "in tune", inclusive at the boundary', () => {
  for (const tol of tunerSettings.TOLERANCES) {
    const m = new TunerModel();
    assert.ok(m.update(read(off(440, tol - 0.01)), S({ tolerance: tol }), chromatic, 0).inTune, `±${tol} inside`);
    assert.ok(!new TunerModel().update(read(off(440, tol + 0.01)), S({ tolerance: tol }), chromatic, 0).inTune, `±${tol} outside`);
    assert.equal(new TunerModel().update(read(off(440, -tol)), S({ tolerance: tol }), chromatic, 0).direction, 'ok');
  }
});
t('reference pitch: same note name, different target', () => {
  const r442 = new TunerModel().update(read(442), S({ a4: 442 }), chromatic, 0);
  assert.equal(r442.note.text, 'A4'); near(r442.cents, 0, 1e-9); assert.ok(r442.inTune);
  const r440 = new TunerModel().update(read(440), S({ a4: 442 }), chromatic, 0);
  assert.equal(r440.note.text, 'A4'); near(r440.cents, -7.851, 1e-3);
  const e2 = new TunerModel().update(read(N.midiToFreq(40, 432)), S({ a4: 432 }), guitar, 0);
  assert.equal(e2.target.label, 'E2'); near(e2.target.freq, N.midiToFreq(40, 432), 1e-9); near(e2.cents, 0, 1e-9);
});
t('auto mode finds the string being played, even when far out of tune', () => {
  const m = new TunerModel();
  const low = m.update(read(off(82.41, -180)), S(), guitar, 0);       // E string almost two semitones flat
  assert.equal(low.stringIndex, 0); assert.ok(low.autoString); assert.equal(low.target.label, 'E2');
  near(low.cents, -180 + N.cents(82.41, N.midiToFreq(40)), 0.01);
  const b = new TunerModel().update(read(246.94), S(), guitar, 0);
  assert.equal(b.target.label, 'B3'); assert.equal(b.stringIndex, 4);
  const hiE = new TunerModel().update(read(329.63), S(), guitar, 0);
  assert.equal(hiE.stringIndex, 5, 'high E is not confused with low E (two octaves apart)');
});
t('auto mode does not guess when the note sits between strings', () => {
  const mid = off(82.41, 250);                                         // halfway from E2 to A2
  const r = new TunerModel().update(read(mid), S(), guitar, 0);
  assert.equal(r.stringIndex, -1); assert.equal(r.target.kind, 'note');
  const far = new TunerModel().update(read(1000), S(), guitar, 0);
  assert.equal(far.stringIndex, -1, 'far above every string');
  const between = new TunerModel().update(read(N.midiToFreq(68)), S(), uke, 0); // G♯4: between G4 and A4
  assert.equal(between.stringIndex, -1);
});
t('auto mode keeps its string while you tune through it', () => {
  const m = new TunerModel();
  m.update(read(82.41), S(), guitar, 0);
  const r = m.update(read(off(82.41, 220)), S(), guitar, 50);          // tightened past the midpoint toward A
  assert.equal(r.stringIndex, 0, 'sticks to the string it was on');
});
t('manual mode targets the chosen string whatever is played', () => {
  const m = new TunerModel();
  const s = S({ stringMode: 'manual', stringIndex: 1 });
  const none = m.update(read(null, 'quiet'), s, guitar, 0);
  assert.equal(none.target.label, 'A2', 'target shown before a note is played');
  const r = m.update(read(82.41), s, guitar, 0);
  assert.equal(r.target.label, 'A2'); assert.equal(r.stringIndex, 1); assert.ok(!r.autoString);
  near(r.cents, N.cents(82.41, 110), 1e-9); assert.equal(r.direction, 'up');
  assert.equal(r.note.text, 'E2', 'the note actually played is still shown');
  const clamp = new TunerModel().update(read(110), S({ stringMode: 'manual', stringIndex: 11 }), guitar, 0);
  assert.equal(clamp.stringIndex, 5, 'index clamped to the tuning');
});
t('a typed frequency overrides strings and notes', () => {
  const r = new TunerModel().update(read(431), S({ targetMode: 'freq', customHz: 432 }), guitar, 0);
  assert.equal(r.target.kind, 'freq'); near(r.target.freq, 432, 1e-9);
  near(r.cents, N.cents(431, 432), 1e-9); near(r.deltaHz, -1, 1e-9);
  assert.equal(r.note.text, 'A4'); assert.equal(r.stringIndex, -1);
});
t('note name hysteresis: no flicker around the half-way point', () => {
  const m = new TunerModel();
  m.update(read(440), S(), chromatic, 0);
  const r = m.update(read(off(440, 54)), S(), chromatic, 50);
  assert.equal(r.note.text, 'A4', '54 ¢ sharp still shows A4 when coming from A4');
  const fresh = new TunerModel().update(read(off(440, 54)), S(), chromatic, 0);
  assert.equal(fresh.note.text, 'A♯4', 'but a fresh reading shows the nearest note');
  assert.equal(m.update(read(off(440, 62)), S(), chromatic, 100).note.text, 'A♯4');
});
t('flat spelling follows the preference and flat tunings', () => {
  assert.equal(new TunerModel().update(read(N.midiToFreq(70)), S({ accidentals: 'flat' }), chromatic, 0).note.text, 'B♭4');
  const half = T.preset('guitar-half-down');
  assert.equal(new TunerModel().update(read(N.midiToFreq(39)), S(), half, 0).target.label, 'E♭2');
});
t('a string held in tune is marked done; changing tuning resets progress', () => {
  const m = new TunerModel();
  let r;
  for (let now = 0; now <= 700; now += 50) r = m.update(read(110), S(), guitar, now);
  assert.ok(r.tuned[1]); assert.ok(!r.tuned[0]);
  const once = [];
  for (let now = 750; now < 1500; now += 50) { const x = m.update(read(110), S(), guitar, now); if (x.justTuned !== null) once.push(x.justTuned); }
  assert.deepEqual(once, [], 'reported once');
  m.update(read(off(110, 30)), S(), guitar, 1600);
  assert.ok(m.update(read(off(110, 30)), S(), guitar, 1650).tuned[1], 'stays done when it drifts');
  m.resetStrings(guitar.strings.length);
  assert.ok(!m.update(read(110), S(), guitar, 2000).tuned[1]);
  const v = new TunerModel().update(read(196), S(), T.preset('violin-standard'), 0);
  assert.equal(v.tuned.length, 4, 'progress sized to the tuning');
});
t('brief or held readings do not mark a string', () => {
  const m = new TunerModel();
  let r;
  for (let now = 0; now <= 400; now += 50) r = m.update(read(110), S(), guitar, now);
  assert.ok(!r.tuned[1], 'only 400 ms');
  for (let now = 450; now <= 1500; now += 50) r = m.update(read(110, 'hold'), S(), guitar, now);
  assert.ok(!r.tuned[1], 'a fading note does not count');
});
t('session history: in-tune notes, one entry per note, capped', () => {
  const m = new TunerModel();
  for (let now = 0; now <= 1000; now += 50) m.update(read(440), S(), chromatic, now);
  assert.equal(m.history.length, 1); assert.equal(m.history[0].label, 'A4');
  let now = 20000;
  for (let k = 0; k < 20; k++) { for (let i = 0; i < 16; i++) m.update(read(N.midiToFreq(50 + k)), S(), chromatic, (now += 50)); now += 11000; }
  assert.equal(m.history.length, 12);
  assert.equal(m.history[0].label, N.label(69));
});
t('"In tune" holds while within tolerance, and does not flicker on the edge', () => {
  const m = new TunerModel(), s = S({ tolerance: 2, targetMode: 'note' });
  let now = 0;
  const at = (c) => m.update(read(off(440, c)), s, chromatic, (now += 50));
  assert.ok(at(1.5).inTune, 'enters inside the tolerance');
  /* hovering just outside (2.2 ¢, within the 0.5 ¢ margin) for less than 150 ms: still in tune */
  assert.ok(at(2.2).inTune && at(2.2).inTune, 'a 100 ms brush past the edge');
  assert.ok(at(1.9).inTune);
  /* staying just outside: out after 150 ms */
  at(2.3); at(2.3); at(2.3);
  const out = at(2.3);
  assert.ok(!out.inTune); assert.equal(out.direction, 'down');
  assert.ok(Math.abs(out.cents - 2.3) < 0.01, 'the cents shown are the measured ones');
  /* well outside: out at once */
  assert.ok(at(0).inTune);
  assert.ok(!at(3).inTune, 'beyond tolerance + margin');
  /* re-entering needs to be within the tolerance itself */
  assert.ok(!at(2.2).inTune && at(2).inTune);
});
t('settling: within tolerance before the pluck has settled says "settle", not "in tune"', () => {
  const m = new TunerModel(), s = S({ tolerance: 3 });
  const r = m.update(Object.assign(read(110), { settled: false }), s, guitar, 0);
  assert.ok(!r.inTune); assert.equal(r.direction, 'settle');
  const far = m.update(Object.assign(read(off(110, -20)), { settled: false }), s, guitar, 50);
  assert.equal(far.direction, 'up', 'an obvious direction is shown at once');
  assert.ok(m.update(Object.assign(read(110), { settled: true }), s, guitar, 100).inTune);
});
t('a faded note ("Pluck again") keeps its reading, without direction, and never counts as tuned', () => {
  const m = new TunerModel();
  const r = m.update(read(off(110, -8), 'decay'), S(), guitar, 0);
  assert.ok(r.hasPitch && r.faded); assert.equal(r.direction, null); assert.ok(!r.inTune);
  assert.equal(r.note.text, 'A2');
  let x; for (let now = 0; now <= 1500; now += 50) x = m.update(read(110, 'decay'), S(), guitar, now);
  assert.ok(!x.tuned[1]);
});
t('a new target starts out of tune', () => {
  const m = new TunerModel(), s = S({ tolerance: 3 });
  assert.ok(m.update(read(110), s, guitar, 0).inTune);
  const next = m.update(read(off(146.832, 2.9)), s, guitar, 50);
  assert.equal(next.stringIndex, 2);
  assert.ok(next.inTune, 'D3 within tolerance on its first reading (settled) is in tune');
  const mm = new TunerModel();
  mm.update(read(110), s, guitar, 0);
  assert.ok(!mm.update(Object.assign(read(146.832), { settled: false }), s, guitar, 50).inTune, 'but not before it has settled');
});

console.log(`\n${n} tuner model tests passed`);
