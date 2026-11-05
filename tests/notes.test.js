/* Run: node tests/notes.test.js — note names, frequencies, cents and reference pitch. */
require('../js/notes.js');
const N = globalThis.MN.notes;
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok —', name); };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);

t('note to frequency at A4 = 440 Hz', () => {
  near(N.midiToFreq(69), 440, 1e-9);
  near(N.midiToFreq(40), 82.4069, 1e-4, 'E2');
  near(N.midiToFreq(60), 261.6256, 1e-4, 'C4');
  near(N.midiToFreq(21), 27.5, 1e-9, 'A0');
  near(N.midiToFreq(108), 4186.009, 1e-3, 'C8');
  near(N.midiToFreq(23), 30.8677, 1e-4, 'B0');
  near(N.midiToFreq(28), 41.2034, 1e-4, 'E1');
  near(N.midiToFreq(76), 659.2551, 1e-4, 'E5');
});
t('reference pitch moves every note, names stay the same', () => {
  near(N.midiToFreq(69, 442), 442, 1e-9);
  near(N.midiToFreq(69, 432), 432, 1e-9);
  near(N.midiToFreq(40, 442), 82.4069 * 442 / 440, 1e-4, 'E2 at 442');
  const n442 = N.nearest(442, 442);
  assert.equal(n442.midi, 69); near(n442.cents, 0, 1e-9);
  assert.equal(N.label(n442.midi), 'A4');
  /* the same 440 Hz is 7.85 ¢ flat of A4 when A4 = 442 */
  near(N.nearest(440, 442).cents, -7.851, 1e-3);
});
t('frequency to nearest note and cents', () => {
  const e2 = N.nearest(82.41);
  assert.equal(N.label(e2.midi), 'E2'); near(e2.cents, 0.0654, 1e-3);
  const sharp = N.nearest(440 * Math.pow(2, 49 / 1200));
  assert.equal(sharp.midi, 69); near(sharp.cents, 49, 1e-9);
  const flat = N.nearest(440 * Math.pow(2, -49 / 1200));
  assert.equal(flat.midi, 69); near(flat.cents, -49, 1e-9);
  assert.equal(N.nearest(440 * Math.pow(2, 51 / 1200)).midi, 70, '51 ¢ sharp of A4 is closer to A♯4');
});
t('cents formula', () => {
  near(N.cents(880, 440), 1200, 1e-9);
  near(N.cents(220, 440), -1200, 1e-9);
  near(N.cents(442, 440), 7.851, 1e-3);
  near(N.cents(440 * Math.pow(2, 1 / 12), 440), 100, 1e-9);
});
t('octave numbers change at C', () => {
  assert.equal(N.label(N.nearest(246.94).midi), 'B3');
  assert.equal(N.label(N.nearest(261.63).midi), 'C4');
  assert.equal(N.label(N.nearest(32.70).midi), 'C1');
  assert.equal(N.label(N.nearest(30.87).midi), 'B0');
  assert.equal(N.name(59).octave, 3); assert.equal(N.name(60).octave, 4);
  assert.equal(N.label(12), 'C0'); assert.equal(N.label(108), 'C8');
});
t('every note from A0 to C8 survives a round trip', () => {
  for (let m = 21; m <= 108; m++) {
    const f = N.midiToFreq(m, 441.5);
    const r = N.nearest(f, 441.5);
    assert.equal(r.midi, m); near(r.cents, 0, 1e-6);
    near(N.freqToMidi(f, 441.5), m, 1e-9);
    assert.equal(N.parse(N.label(m)), m, 'sharp spelling of ' + m);
    assert.equal(N.parse(N.label(m, true)), m, 'flat spelling of ' + m);
  }
});
t('sharp and flat spellings', () => {
  assert.equal(N.label(61), 'C♯4'); assert.equal(N.label(61, true), 'D♭4');
  assert.equal(N.label(63, true), 'E♭4');
  const parts = N.name(70, true);
  assert.deepEqual([parts.letter, parts.accidental, parts.octave], ['B', '♭', 4]);
});
t('parsing note names', () => {
  assert.equal(N.parse('E2'), 40);
  assert.equal(N.parse('e2'), 40);
  assert.equal(N.parse('Eb2'), 39); assert.equal(N.parse('E♭2'), 39);
  assert.equal(N.parse('D#3'), 51); assert.equal(N.parse('D♯3'), 51); assert.equal(N.parse('F♯ 3'), 54);
  assert.equal(N.parse(' bb1 '), 34, 'lowercase b-flat');
  assert.equal(N.parse('B#3'), 60, 'B♯3 is C4');
  assert.equal(N.parse('Cb4'), 59, 'C♭4 is B3');
  assert.equal(N.parse('A0'), 21); assert.equal(N.parse('C8'), 108);
  for (const bad of ['', 'H2', 'E', '2', 'E22', 'E-2', 'C9', 'B-1', 'E2 A2', '<b>', null, undefined, 42, {}, 'Ebbbb2', 'A0000000'])
    assert.equal(N.parse(bad), null, 'should reject ' + JSON.stringify(bad));
});
t('invalid and non-finite input', () => {
  for (const bad of [NaN, Infinity, -Infinity, 0, -440, undefined, null, '440']) {
    assert.ok(Number.isNaN(N.freqToMidi(bad)), 'freqToMidi ' + bad);
    assert.equal(N.nearest(bad), null, 'nearest ' + bad);
    assert.ok(Number.isNaN(N.cents(bad, 440)) && Number.isNaN(N.cents(440, bad)), 'cents ' + bad);
  }
  assert.ok(Number.isNaN(N.midiToFreq(NaN)));
  assert.ok(Number.isNaN(N.midiToFreq(69, 0)));
  assert.equal(N.name(NaN), null);
});
t('reference pitch limits', () => {
  assert.ok(N.validRef(400) && N.validRef(480) && N.validRef(442.5));
  assert.ok(!N.validRef(399.9) && !N.validRef(480.1) && !N.validRef(NaN) && !N.validRef('440'));
  assert.equal(N.clampRef(300), 400); assert.equal(N.clampRef(900), 480); assert.equal(N.clampRef(NaN), 440);
});
t('frequency range for targets', () => {
  assert.ok(N.validFreq(25) && N.validFreq(4200) && N.validFreq(432));
  assert.ok(!N.validFreq(24.99) && !N.validFreq(4200.1) && !N.validFreq(Infinity) && !N.validFreq(NaN));
});
t('display formatting has no floating-point artefacts', () => {
  assert.equal(N.hz(82.40688659), '82.41');
  assert.equal(N.hz(440), '440.00');
  assert.equal(N.hz(0.1 + 0.2), '0.30');
  assert.equal(N.signed(-0.04), '0.0', 'no "−0.0"');
  assert.equal(N.signed(0.04), '0.0');
  assert.equal(N.signed(3.25), '+3.3');
  assert.equal(N.signed(-12), '−12.0', 'real minus sign');
  assert.equal(N.fixed(-0.0001, 2), '0.00');
  assert.equal(N.hz(NaN), '–'); assert.equal(N.signed(Infinity), '–');
});
t('temperament table: equal temperament is the only one, and it is exact', () => {
  assert.deepEqual(Object.keys(N.TEMPERAMENTS), ['equal']);
  for (let m = 21; m <= 108; m += 7) near(N.midiToFreq(m, 440, 'equal'), 440 * Math.pow(2, (m - 69) / 12), 1e-9);
  near(N.midiToFreq(69, 440, 'nonexistent'), 440, 1e-9, 'unknown temperament falls back to equal');
});

console.log(`\n${n} note tests passed`);
