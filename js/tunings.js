/* tunings.js — instrument presets and the custom tuning library.

   Presets are data, not code: every instrument and tuning lives in the INSTRUMENTS table
   below and nothing else in the app knows about any particular instrument. A tuning lists
   its strings by note name (low to high as they sit on the instrument; re-entrant tunings
   such as ukulele keep their physical order). Frequencies are not stored: they are
   computed from the note, the reference pitch (A4) and the temperament, so changing A4
   moves every string correctly.

   To add an instrument or a tuning, add an entry here and run `npm test`; the tests check
   that every note parses, every string is inside the detector's range and ids are unique.
   See docs/TUNER.md. */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const N = MN.notes;

  const INSTRUMENTS = [
    { id: 'chromatic', name: 'Chromatic', blurb: 'Any note, no strings', tunings: [
      { id: 'chromatic', name: 'All notes', notes: '' },
    ] },
    { id: 'guitar', name: 'Guitar', blurb: '6 and 7 strings', tunings: [
      { id: 'guitar-standard', name: 'Standard', notes: 'E2 A2 D3 G3 B3 E4' },
      { id: 'guitar-drop-d', name: 'Drop D', notes: 'D2 A2 D3 G3 B3 E4' },
      { id: 'guitar-half-down', name: 'Half step down', alias: 'E♭ standard', notes: 'E♭2 A♭2 D♭3 G♭3 B♭3 E♭4' },
      { id: 'guitar-d-standard', name: 'D Standard', alias: 'Whole step down', notes: 'D2 G2 C3 F3 A3 D4' },
      { id: 'guitar-drop-c', name: 'Drop C', notes: 'C2 G2 C3 F3 A3 D4' },
      { id: 'guitar-open-d', name: 'Open D', notes: 'D2 A2 D3 F♯3 A3 D4' },
      { id: 'guitar-open-g', name: 'Open G', notes: 'D2 G2 D3 G3 B3 D4' },
      { id: 'guitar-open-e', name: 'Open E', notes: 'E2 B2 E3 G♯3 B3 E4' },
      { id: 'guitar-open-c', name: 'Open C', notes: 'C2 G2 C3 G3 C4 E4' },
      { id: 'guitar-dadgad', name: 'DADGAD', notes: 'D2 A2 D3 G3 A3 D4' },
      { id: 'guitar-7-standard', name: '7-string standard', notes: 'B1 E2 A2 D3 G3 B3 E4' },
    ] },
    { id: 'bass', name: 'Bass', blurb: '4, 5 and 6 strings', tunings: [
      { id: 'bass-4-standard', name: '4-string standard', notes: 'E1 A1 D2 G2' },
      { id: 'bass-4-drop-d', name: '4-string Drop D', notes: 'D1 A1 D2 G2' },
      { id: 'bass-4-half-down', name: '4-string half step down', notes: 'E♭1 A♭1 D♭2 G♭2' },
      { id: 'bass-5-standard', name: '5-string standard', notes: 'B0 E1 A1 D2 G2' },
      { id: 'bass-5-drop-a', name: '5-string Drop A', notes: 'A0 E1 A1 D2 G2' },
      { id: 'bass-6-standard', name: '6-string standard', notes: 'B0 E1 A1 D2 G2 C3' },
    ] },
    { id: 'violin', name: 'Violin', blurb: 'G D A E', tunings: [
      { id: 'violin-standard', name: 'Standard', notes: 'G3 D4 A4 E5' },
    ] },
    { id: 'viola', name: 'Viola', blurb: 'C G D A', tunings: [
      { id: 'viola-standard', name: 'Standard', notes: 'C3 G3 D4 A4' },
    ] },
    { id: 'cello', name: 'Cello', blurb: 'C G D A', tunings: [
      { id: 'cello-standard', name: 'Standard', notes: 'C2 G2 D3 A3' },
    ] },
    { id: 'double-bass', name: 'Double bass', blurb: 'Orchestral and solo', tunings: [
      { id: 'double-bass-orchestral', name: 'Orchestral', notes: 'E1 A1 D2 G2' },
      { id: 'double-bass-solo', name: 'Solo', alias: 'A whole step up', notes: 'F♯1 B1 E2 A2' },
      { id: 'double-bass-5', name: '5-string, low B', notes: 'B0 E1 A1 D2 G2' },
    ] },
    { id: 'ukulele', name: 'Ukulele', blurb: 'Soprano, concert, tenor, baritone', tunings: [
      { id: 'ukulele-standard', name: 'Standard (high G)', notes: 'G4 C4 E4 A4', meta: 'Re-entrant: the G string is higher than the C.' },
      { id: 'ukulele-low-g', name: 'Low G', notes: 'G3 C4 E4 A4' },
      { id: 'ukulele-d', name: 'D tuning', alias: 'Vintage', notes: 'A4 D4 F♯4 B4' },
      { id: 'ukulele-baritone', name: 'Baritone', notes: 'D3 G3 B3 E4' },
    ] },
    { id: 'mandolin', name: 'Mandolin', blurb: 'G D A E', tunings: [
      { id: 'mandolin-standard', name: 'Standard', notes: 'G3 D4 A4 E5', meta: 'Each note is a pair of strings (a course); tune both to the same pitch.' },
    ] },
    { id: 'banjo', name: 'Banjo', blurb: '5-string', tunings: [
      { id: 'banjo-open-g', name: 'Open G', notes: 'G4 D3 G3 B3 D4', meta: 'The short 5th string is listed first, as it sits on the neck.' },
    ] },
  ];
  const CUSTOM_INSTRUMENT = { id: 'custom', name: 'Other instrument' };
  const DEFAULT_TUNING = 'guitar-standard';
  const MAX_STRINGS = 12, MAX_NAME = 40, MAX_CUSTOM = 50;

  const tokens = (notes) => (Array.isArray(notes) ? notes : String(notes || '').split(/[\s,;]+/)).map((t) => String(t).trim()).filter(Boolean);
  const usesFlats = (notes) => tokens(notes).some((t) => /^[A-Ga-g]\s*(♭|b)/.test(t));

  /* A tuning ready for use: strings carry their MIDI number and a label spelled as written. */
  function normalize(t, instrumentId, custom = false) {
    const list = tokens(t.notes);
    const flats = t.flats != null ? !!t.flats : usesFlats(list);
    const strings = list.map((text, index) => {
      const midi = N.parse(text);
      return { index, midi, label: midi === null ? text : N.label(midi, flats) };
    });
    return Object.freeze({
      id: t.id, instrumentId, name: t.name, alias: t.alias || '', meta: t.meta || '', flats, custom,
      strings: Object.freeze(strings.map(Object.freeze)),
    });
  }

  const PRESETS = [];
  for (const inst of INSTRUMENTS) for (const t of inst.tunings) PRESETS.push(normalize(t, inst.id));
  const presetById = new Map(PRESETS.map((t) => [t.id, t]));
  const instrumentById = new Map(INSTRUMENTS.map((i) => [i.id, i]));
  const instrumentName = (id) => (instrumentById.get(id) || CUSTOM_INSTRUMENT).name;

  /* Frequency of string i of a tuning, for a reference pitch and temperament. */
  function stringFreq(tuning, i, a4 = N.REF.default, temp = 'equal') {
    const s = tuning && tuning.strings[i];
    return s && s.midi !== null ? N.midiToFreq(s.midi, a4, temp) : NaN;
  }

  /* ---- validation of user tunings ---- */
  function cleanName(name) {
    return String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  }
  /* Checks a custom tuning. Returns { ok, errors: [text], value } where value is safe to store. */
  function validate(input) {
    const errors = [];
    const data = input && typeof input === 'object' ? input : {};
    const name = cleanName(data.name);
    if (!name) errors.push('Give the tuning a name.');
    const instrumentId = instrumentById.has(data.instrumentId) && data.instrumentId !== 'chromatic' ? data.instrumentId : CUSTOM_INSTRUMENT.id;
    const list = tokens(data.notes);
    if (!list.length) errors.push('Add at least one string, for example “E2 A2 D3”.');
    if (list.length > MAX_STRINGS) errors.push(`Up to ${MAX_STRINGS} strings.`);
    const bad = [];
    for (const t of list.slice(0, MAX_STRINGS)) {
      const midi = N.parse(t);
      if (midi === null) bad.push(t);
      else {
        const lo = N.midiToFreq(midi, N.REF.min), hi = N.midiToFreq(midi, N.REF.max);
        if (lo < N.RANGE.min || hi > N.RANGE.max) bad.push(t);
      }
    }
    if (bad.length) errors.push(`Not a note the tuner can use: ${bad.slice(0, 4).join(', ')}. Write notes like E2, F♯3 or B♭1, between A0 and C8.`);
    const value = errors.length ? null : { name, instrumentId, notes: list.map((t) => N.label(N.parse(t), usesFlats([t]))).join(' ') };
    return { ok: !errors.length, errors, value };
  }

  /* ---- custom tuning library (stored in the browser only) ---- */
  const KEY = 'tuner.v1.tunings';
  const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const newId = () => 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  class CustomTunings {
    constructor(storage) {
      this.storage = storage || (root.localStorage ? root.localStorage : memoryStorage());
      this.items = this.load();
    }
    load() {
      let raw = [];
      try { raw = JSON.parse(this.storage.getItem(KEY) || '[]'); } catch (e) { raw = []; }
      if (!Array.isArray(raw)) raw = [];
      const out = [];
      for (const r of raw.slice(0, MAX_CUSTOM)) {
        if (!r || typeof r.id !== 'string' || !/^custom-[a-z0-9]{3,24}$/.test(r.id)) continue;
        const v = validate(r);
        if (v.ok) out.push(Object.assign({ id: r.id, created: Number.isFinite(r.created) ? r.created : Date.now(), updated: Number.isFinite(r.updated) ? r.updated : Date.now() }, v.value));
      }
      return out;
    }
    save() { try { this.storage.setItem(KEY, JSON.stringify(this.items)); return true; } catch (e) { return false; } }
    list() { return this.items.map((r) => normalize(r, r.instrumentId, true)); }
    get(id) { const r = this.items.find((x) => x.id === id); return r ? normalize(r, r.instrumentId, true) : null; }
    raw(id) { const r = this.items.find((x) => x.id === id); return r ? Object.assign({}, r) : null; }
    create(data) {
      const v = validate(data);
      if (!v.ok) return v;
      if (this.items.length >= MAX_CUSTOM) return { ok: false, errors: [`You can keep up to ${MAX_CUSTOM} tunings. Delete one to make room.`] };
      const rec = Object.assign({ id: newId(), created: Date.now(), updated: Date.now() }, v.value);
      this.items.unshift(rec);
      const saved = this.save();
      return { ok: true, errors: [], id: rec.id, saved, tuning: normalize(rec, rec.instrumentId, true) };
    }
    update(id, data) {
      const i = this.items.findIndex((x) => x.id === id);
      if (i < 0) return { ok: false, errors: ['That tuning no longer exists.'] };
      const v = validate(data);
      if (!v.ok) return v;
      this.items[i] = Object.assign({}, this.items[i], v.value, { updated: Date.now() });
      const saved = this.save();
      return { ok: true, errors: [], id, saved, tuning: normalize(this.items[i], this.items[i].instrumentId, true) };
    }
    remove(id) { const n = this.items.length; this.items = this.items.filter((x) => x.id !== id); if (this.items.length !== n) this.save(); return this.items.length !== n; }
    clear() { this.items = []; this.save(); }
  }

  MN.tunings = {
    INSTRUMENTS, PRESETS, CUSTOM_INSTRUMENT, DEFAULT_TUNING, MAX_STRINGS, MAX_NAME, MAX_CUSTOM, KEY,
    preset: (id) => presetById.get(id) || null, instrument: (id) => instrumentById.get(id) || null, instrumentName,
    normalize, stringFreq, validate, cleanName, tokens, CustomTunings, memoryStorage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
