/* tuner-store.js — the tuner's own settings, kept apart from the metronome's so neither can
   break the other. Saved to localStorage under "tuner.v1.settings" and validated on load,
   so an old or hand-edited value can never reach the audio code. App-wide preferences
   (theme, palette, help hints, Simple/Advanced) stay in the metronome store. */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const N = MN.notes;
  const KEY = 'tuner.v1.settings';

  const TOLERANCES = [1, 2, 3, 5, 10];
  const SENSITIVITY = { high: -66, normal: -58, low: -48 };   // level gate in dBFS

  const DEFAULTS = Object.freeze({
    tuningId: 'guitar-standard',
    stringMode: 'auto',      // 'auto': follow the string you play · 'manual': you pick the string
    stringIndex: 0,
    a4: 440,
    tolerance: 3,            // ± cents counted as in tune
    temperament: 'equal',
    accidentals: 'sharp',    // how chromatic notes are spelled: 'sharp' (C♯) or 'flat' (D♭)
    targetMode: 'note',      // 'note': nearest note or string · 'freq': a frequency you type
    customHz: 440,
    sensitivity: 'normal',
    detailed: true,          // full measurement table (Advanced)
    deviceId: '',
    toneWave: 'sine',
    toneVolume: 0.35,
    toneHz: 440,
  });

  const oneOf = (v, list, d) => (list.includes(v) ? v : d);
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);

  /* Every field is checked; an invalid one falls back to `base` (the current settings when
     changing a value, the defaults when loading), so bad input never replaces good. */
  function sanitize(saved, tuningExists, base = DEFAULTS) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const d = base;
    return {
      tuningId: typeof s.tuningId === 'string' && (!tuningExists || tuningExists(s.tuningId)) ? s.tuningId : d.tuningId,
      stringMode: oneOf(s.stringMode, ['auto', 'manual'], d.stringMode),
      stringIndex: Math.round(num(s.stringIndex, 0, 11, d.stringIndex)),
      a4: Math.round(num(s.a4, N.REF.min, N.REF.max, d.a4) * 100) / 100,
      tolerance: oneOf(s.tolerance, TOLERANCES, d.tolerance),
      temperament: N.TEMPERAMENTS[s.temperament] ? s.temperament : d.temperament,
      accidentals: oneOf(s.accidentals, ['sharp', 'flat'], d.accidentals),
      targetMode: oneOf(s.targetMode, ['note', 'freq'], d.targetMode),
      customHz: Math.round(num(s.customHz, N.RANGE.min, N.RANGE.max, d.customHz) * 1000) / 1000,
      sensitivity: oneOf(s.sensitivity, Object.keys(SENSITIVITY), d.sensitivity),
      detailed: typeof s.detailed === 'boolean' ? s.detailed : d.detailed,
      deviceId: typeof s.deviceId === 'string' && s.deviceId.length < 300 ? s.deviceId : d.deviceId,
      toneWave: oneOf(s.toneWave, ['sine', 'triangle'], d.toneWave),
      toneVolume: num(s.toneVolume, 0, 1, d.toneVolume),
      toneHz: Math.round(num(s.toneHz, 20, 5000, d.toneHz) * 1000) / 1000,
    };
  }

  class TunerStore {
    constructor(storage, tuningExists) {
      this.storage = storage || (root.localStorage ? root.localStorage : MN.tunings.memoryStorage());
      this.tuningExists = tuningExists || null;
      let saved = {};
      try { saved = JSON.parse(this.storage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
      this.state = sanitize(saved, this.tuningExists);
      this.subs = new Set();
      this.timer = null;
    }
    get() { return this.state; }
    subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
    set(patch) {
      const prev = this.state;
      this.state = sanitize(Object.assign({}, prev, patch), this.tuningExists, prev);
      const changed = {};
      for (const k of Object.keys(patch)) if (prev[k] !== this.state[k]) changed[k] = this.state[k];
      if (!Object.keys(changed).length) return;
      for (const fn of this.subs) { try { fn(this.state, changed, prev); } catch (e) { console.error(e); } }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 200);
    }
    flush() { clearTimeout(this.timer); try { this.storage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { /* private mode or full */ } }
    /* Restore defaults but keep the device and the chosen tuning. */
    reset() { this.set(Object.assign({}, DEFAULTS, { tuningId: this.state.tuningId, deviceId: this.state.deviceId })); }
  }

  MN.TunerStore = TunerStore;
  MN.tunerSettings = { KEY, DEFAULTS, TOLERANCES, SENSITIVITY, sanitize };
})(typeof window !== 'undefined' ? window : globalThis);
