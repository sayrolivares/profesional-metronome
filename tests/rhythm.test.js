/* Run: node tests/rhythm.test.js */
require('../js/rhythm.js');
const R = globalThis.MN.rhythm;
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok —', name); };

t('tempo markings', () => {
  assert.equal(R.marking(60), 'Adagio');
  assert.equal(R.marking(120), 'Allegro');
  assert.equal(R.marking(20), 'Grave');
  assert.equal(R.marking(300), 'Prestissimo');
});
t('beat duration', () => {
  assert.equal(R.beatSeconds(120), 0.5);
  assert.equal(R.beatSeconds(60), 1);
});
t('compound meters', () => {
  assert.equal(R.beatsPerBar({ num: 6, den: 8, compound: true }), 2);
  assert.equal(R.beatsPerBar({ num: 6, den: 8, compound: false }), 6);
  assert.equal(R.beatsPerBar({ num: 12, den: 8, compound: true }), 4);
  assert.equal(R.beatsPerBar({ num: 7, den: 4 }), 7);
  assert.equal(R.beatUnitLabel({ num: 6, den: 8, compound: true }), '♪.');
  assert.equal(R.beatUnitLabel({ num: 2, den: 2 }), '𝅗𝅥');
});
t('default accents', () => {
  assert.deepEqual(R.defaultAccents({ num: 4, den: 4 }), [3, 1, 2, 1]);
  assert.deepEqual(R.defaultAccents({ num: 6, den: 8, compound: false }), [3, 1, 1, 2, 1, 1]);
});
t('subdivision offsets are aligned and ordered', () => {
  assert.deepEqual(R.subOffsets(4, 'straight'), [0, 0.25, 0.5, 0.75]);
  const sw = R.subOffsets(2, 'swing');
  assert.ok(Math.abs(sw[1] - 2 / 3) < 1e-9);
  const tr = R.subOffsets(3, 'swing'); // odd: feel ignored
  assert.ok(Math.abs(tr[1] - 1 / 3) < 1e-9);
  for (const n of [1, 2, 3, 4, 6, 8]) for (const f of ['straight', 'swing', 'shuffle', 'dotted']) {
    const o = R.subOffsets(n, f);
    assert.equal(o.length, n); assert.equal(o[0], 0);
    for (let i = 1; i < n; i++) assert.ok(o[i] > o[i - 1] && o[i] < 1);
  }
});
t('tap tempo', () => {
  const tt = new R.TapTempo();
  let now = 0; let bpm = null;
  for (let i = 0; i < 5; i++) { bpm = tt.tap(now); now += 0.5; }
  assert.equal(bpm, 120);
  tt.tap(now + 5); // long gap resets
  assert.equal(tt.count(), 1);
  const tt2 = new R.TapTempo(); tt2.tap(0); tt2.tap(0.05); // too fast ignored
  assert.equal(tt2.count(), 1);
});
t('trainer never overshoots', () => {
  const cfg = { start: 60, step: 7, target: 100 };
  let b = 60; for (let i = 0; i < 20; i++) b = R.trainerStep(b, cfg);
  assert.equal(b, 100);
  const down = { start: 120, step: 10, target: 85 };
  b = 120; for (let i = 0; i < 20; i++) b = R.trainerStep(b, down);
  assert.equal(b, 85);
});
t('progressive stages', () => {
  const s = [{ bpm: 60, seconds: 120 }, { bpm: 65, seconds: 120 }];
  assert.equal(R.progressiveStage(s, 10).bpm, 60);
  assert.equal(R.progressiveStage(s, 130).bpm, 65);
  assert.equal(R.progressiveStage(s, 240), null);
});
console.log(`\n${n} test groups passed`);
