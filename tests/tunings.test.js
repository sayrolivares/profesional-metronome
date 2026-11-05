/* Run: node tests/tunings.test.js — instrument presets, custom tuning validation and the
   custom tuning library, plus the tuner settings store. */
require('../js/notes.js'); require('../js/tunings.js'); require('../js/tuner-store.js');
const { notes: N, tunings: T, TunerStore, tunerSettings } = globalThis.MN;
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok —', name); };
const notesOf = (id) => T.preset(id).strings.map((s) => s.label).join(' ');
const hzOf = (id, a4 = 440) => T.preset(id).strings.map((s, i) => T.stringFreq(T.preset(id), i, a4).toFixed(2)).join(' ');

t('every required instrument is present', () => {
  for (const id of ['guitar', 'bass', 'violin', 'viola', 'cello', 'double-bass', 'ukulele', 'mandolin']) assert.ok(T.instrument(id), id);
});
t('the required presets have the right notes', () => {
  assert.equal(notesOf('guitar-standard'), 'E2 A2 D3 G3 B3 E4');
  assert.equal(notesOf('guitar-drop-d'), 'D2 A2 D3 G3 B3 E4');
  assert.equal(notesOf('guitar-d-standard'), 'D2 G2 C3 F3 A3 D4');
  assert.equal(notesOf('guitar-half-down'), 'E♭2 A♭2 D♭3 G♭3 B♭3 E♭4');
  assert.equal(notesOf('guitar-open-d'), 'D2 A2 D3 F♯3 A3 D4');
  assert.equal(notesOf('guitar-open-g'), 'D2 G2 D3 G3 B3 D4');
  assert.equal(notesOf('guitar-open-e'), 'E2 B2 E3 G♯3 B3 E4');
  assert.equal(notesOf('guitar-dadgad'), 'D2 A2 D3 G3 A3 D4');
  assert.equal(notesOf('bass-4-standard'), 'E1 A1 D2 G2');
  assert.equal(notesOf('bass-5-standard'), 'B0 E1 A1 D2 G2');
  assert.equal(notesOf('bass-6-standard'), 'B0 E1 A1 D2 G2 C3');
  assert.equal(notesOf('violin-standard'), 'G3 D4 A4 E5');
  assert.equal(notesOf('viola-standard'), 'C3 G3 D4 A4');
  assert.equal(notesOf('cello-standard'), 'C2 G2 D3 A3');
  assert.equal(notesOf('double-bass-orchestral'), 'E1 A1 D2 G2');
  assert.equal(notesOf('ukulele-standard'), 'G4 C4 E4 A4');
  assert.equal(notesOf('ukulele-low-g'), 'G3 C4 E4 A4');
  assert.equal(notesOf('mandolin-standard'), 'G3 D4 A4 E5');
});
t('target frequencies come from the notes and the reference pitch', () => {
  assert.equal(hzOf('guitar-standard'), '82.41 110.00 146.83 196.00 246.94 329.63');
  assert.equal(hzOf('violin-standard', 442), '196.89 295.00 442.00 662.25'); // equal temperament, not pure fifths
  assert.equal(hzOf('bass-5-standard'), '30.87 41.20 55.00 73.42 98.00');
});
t('every preset is valid, inside the detector range, with unique ids', () => {
  const ids = new Set();
  for (const p of T.PRESETS) {
    assert.ok(!ids.has(p.id), 'duplicate id ' + p.id); ids.add(p.id);
    assert.ok(p.name && T.instrument(p.instrumentId), p.id);
    assert.ok(p.strings.length <= T.MAX_STRINGS, p.id);
    for (const s of p.strings) {
      assert.ok(Number.isInteger(s.midi), `${p.id}: ${s.label} does not parse`);
      for (const a4 of [N.REF.min, N.REF.max]) assert.ok(N.validFreq(N.midiToFreq(s.midi, a4)), `${p.id}: ${s.label} out of range at A4 = ${a4}`);
    }
    if (p.instrumentId !== 'chromatic') assert.ok(p.strings.length >= 4, p.id + ' has strings');
  }
  assert.ok(T.preset(T.DEFAULT_TUNING));
  assert.ok(Object.isFrozen(T.preset('guitar-standard').strings), 'presets are read-only');
});
t('validation accepts sensible tunings and normalises spelling', () => {
  const v = T.validate({ name: '  My   Open D  ', instrumentId: 'guitar', notes: 'd2 a2 d3 f#3 a3 d4' });
  assert.ok(v.ok, v.errors.join());
  assert.equal(v.value.name, 'My Open D');
  assert.equal(v.value.notes, 'D2 A2 D3 F♯3 A3 D4');
  assert.equal(T.validate({ name: 'Flat', notes: 'Eb2, Ab2; Db3' }).value.notes, 'E♭2 A♭2 D♭3');
  assert.equal(T.validate({ name: 'x', notes: ['G4', 'C4'], instrumentId: 'nope' }).value.instrumentId, 'custom');
});
t('validation rejects bad input with a readable reason', () => {
  const cases = [
    [{ name: '', notes: 'E2' }, /name/],
    [{ name: 'x', notes: '' }, /at least one string/],
    [{ name: 'x', notes: 'E2 H2' }, /H2/],
    [{ name: 'x', notes: 'C0' }, /C0/],                     // 16 Hz: below the detector
    [{ name: 'x', notes: 'D8' }, /not a note|Not a note/],   // outside C0–C8
    [{ name: 'x', notes: Array(13).fill('E2').join(' ') }, /12 strings/],
    [null, /name/],
  ];
  for (const [input, re] of cases) {
    const v = T.validate(input);
    assert.ok(!v.ok && v.value === null, JSON.stringify(input));
    assert.ok(v.errors.some((e) => re.test(e)), `${JSON.stringify(input)} → ${v.errors.join(' | ')}`);
  }
});
t('names are cleaned of markup and control characters', () => {
  const v = T.validate({ name: '<img src=x onerror=alert(1)>\u0007Baritone', notes: 'B1' });
  assert.ok(v.ok);
  assert.ok(!/[<>]/.test(v.value.name) && !/\u0007/.test(v.value.name));
  assert.equal(T.validate({ name: 'x'.repeat(100), notes: 'E2' }).value.name.length, T.MAX_NAME);
});
t('custom library: create, read, rename, change, delete, persist', () => {
  const store = T.memoryStorage();
  const lib = new T.CustomTunings(store);
  const a = lib.create({ name: 'Nashville', instrumentId: 'guitar', notes: 'E3 A3 D4 G4 B3 E4' });
  assert.ok(a.ok && a.id.startsWith('custom-'));
  assert.equal(lib.get(a.id).strings.length, 6);
  assert.ok(lib.get(a.id).custom);
  assert.ok(lib.update(a.id, { name: 'High-strung', instrumentId: 'guitar', notes: 'E3 A3 D4 G4 B3 E4' }).ok);
  assert.equal(lib.get(a.id).name, 'High-strung');
  assert.ok(!lib.update(a.id, { name: 'x', notes: 'nope' }).ok, 'bad update rejected');
  assert.equal(lib.get(a.id).name, 'High-strung', 'and the old version kept');
  const again = new T.CustomTunings(store);
  assert.equal(again.list().length, 1, 'restored from storage');
  assert.ok(again.remove(a.id));
  assert.equal(new T.CustomTunings(store).list().length, 0);
  assert.ok(!lib.update('custom-missing', { name: 'x', notes: 'E2' }).ok);
});
t('custom library survives corrupt or hostile storage', () => {
  for (const raw of ['not json', '{"a":1}', 'null', '[1,2,3]', JSON.stringify([{ id: '../../x', name: 'a', notes: 'E2' }, { id: 'custom-ok123', name: 'Good', notes: 'E2 A2' }, { id: 'custom-bad12', name: 'Bad', notes: 'Z9' }])]) {
    const s = T.memoryStorage(); s.setItem(T.KEY, raw);
    const lib = new T.CustomTunings(s);
    assert.ok(Array.isArray(lib.list()));
    for (const x of lib.list()) assert.ok(/^custom-[a-z0-9]+$/.test(x.id) && x.strings.every((st) => Number.isInteger(st.midi)));
  }
  const s = T.memoryStorage(); s.setItem(T.KEY, JSON.stringify([{ id: 'custom-ok123', name: 'Good', notes: 'E2 A2' }]));
  assert.equal(new T.CustomTunings(s).list()[0].name, 'Good');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const lib = new T.CustomTunings(throwing);
  const r = lib.create({ name: 'x', notes: 'E2' });
  assert.ok(r.ok && r.saved === false, 'works in memory when storage is unavailable');
});
t('settings store: defaults, validation and persistence', () => {
  const s = T.memoryStorage();
  const st = new TunerStore(s, (id) => !!T.preset(id));
  assert.equal(st.get().a4, 440); assert.equal(st.get().tolerance, 3); assert.equal(st.get().tuningId, 'guitar-standard');
  st.set({ a4: 442, tolerance: 5, tuningId: 'violin-standard' }); st.flush();
  const again = new TunerStore(s, (id) => !!T.preset(id));
  assert.equal(again.get().a4, 442); assert.equal(again.get().tuningId, 'violin-standard');
  again.set({ a4: 900, tolerance: 7, stringMode: 'sideways', customHz: -3, tuningId: 'missing' });
  assert.equal(again.get().a4, 442, 'out-of-range A4 ignored: the previous value stays');
  assert.equal(again.get().tolerance, 5); assert.equal(again.get().stringMode, 'auto');
  assert.equal(again.get().customHz, 440); assert.equal(again.get().tuningId, 'violin-standard', 'unknown tuning ignored');
  s.setItem(tunerSettings.KEY, '{broken');
  assert.equal(new TunerStore(s).get().a4, 440, 'corrupt storage falls back to defaults');
  const ev = []; again.subscribe((state, changed) => ev.push(changed));
  again.set({ a4: 432 }); again.set({ a4: 432 });
  assert.deepEqual(ev, [{ a4: 432 }], 'only real changes notify');
  again.reset();
  assert.equal(again.get().a4, 440);
});

console.log(`\n${n} tuning tests passed`);
