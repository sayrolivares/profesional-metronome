/* store.js — metronome state, presets, history, preferences. Persists to localStorage. */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const R = MN.rhythm;
  const KEY = 'metronome.v1';

  const DEFAULTS = {
    bpm: 100, maxBpm: 300,
    sig: { num: 4, den: 4, compound: true },
    accents: [3, 1, 2, 1],
    subdivision: 1, subPattern: [1], feel: 'straight',
    soundAccent: 'warm-wood', soundBeat: 'soft-wood', soundSub: 'soft-click', soundPoly: 'marimba',
    masterVolume: 0.8, accentVolume: 1.0, subVolume: 0.6, polyVolume: 0.7, room: 0, muted: false,
    panBeat: 0, panSub: 0, panPoly: 0,
    countInBars: 0,
    silent: { enabled: false, play: 2, silence: 2 },
    trainer: { enabled: false, start: 60, step: 2, every: 4, target: 100 },
    progressive: { enabled: false, stages: [{ bpm: 60, seconds: 120 }, { bpm: 65, seconds: 120 }, { bpm: 70, seconds: 120 }] },
    poly: { enabled: false, against: 3 },
    timer: { enabled: false, minutes: 5, seconds: 0, notify: true },
    visual: 'full', pendulum: false,
    theme: 'dark', palette: 'luthier', terms: 'both', mode: 'simple', panel: 'rhythm', help: true,
    refFreq: 440,
    sessionName: '',
  };

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  /* Merge saved settings over defaults one level deep, rejecting values of the wrong
     type, so a settings file from an older version can never feed NaN into the audio. */
  function sanitize(saved) {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) {
      const d = DEFAULTS[k], v = saved ? saved[k] : undefined;
      if (Array.isArray(d)) out[k] = Array.isArray(v) ? v.filter((x) => typeof x === 'number' && Number.isFinite(x)) : d.slice();
      else if (d && typeof d === 'object') {
        const o = {};
        for (const kk of Object.keys(d)) {
          const dv = d[kk], vv = v && typeof v === 'object' ? v[kk] : undefined;
          if (typeof dv === 'number') o[kk] = Number.isFinite(vv) ? vv : dv;
          else if (typeof dv === 'boolean') o[kk] = typeof vv === 'boolean' ? vv : dv;
          else if (Array.isArray(dv)) o[kk] = Array.isArray(vv) ? vv.filter((x) => x && Number.isFinite(x.bpm) && Number.isFinite(x.seconds)) : JSON.parse(JSON.stringify(dv));
          else o[kk] = vv === undefined ? dv : vv;
        }
        out[k] = o;
      } else if (typeof d === 'number') out[k] = Number.isFinite(v) ? v : d;
      else if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : d;
      else out[k] = typeof v === typeof d ? v : d;
    }
    if (!['light', 'dark', 'auto'].includes(out.theme)) out.theme = 'dark';
    if (MN.themes && !MN.themes.PALETTES.some((p) => p.id === out.palette)) out.palette = MN.themes.DEFAULT;
    if (!['us', 'uk', 'both'].includes(out.terms)) out.terms = 'both';
    out.bpm = R.clamp(Math.round(out.bpm), 20, out.maxBpm);
    if (![1, 2, 3, 4, 6, 8].includes(out.subdivision)) out.subdivision = 1;
    if (out.accents.length !== R.beatsPerBar(out.sig)) out.accents = R.defaultAccents(out.sig);
    return out;
  }

  class Store {
    constructor() {
      const saved = load(KEY + '.settings', {});
      this.state = sanitize(saved);
      if (!saved || !saved.terms) this.state.terms = MN.terms ? MN.terms.detect() : 'both';   // first run: from the browser language
      this.state.muted = false; // never start muted
      this.presets = load(KEY + '.presets', []);
      this.history = load(KEY + '.history', []);
      this.accentPatterns = load(KEY + '.accentPatterns', []);
      this.subs = new Set();
      this.persistTimer = null;
    }
    get() { return this.state; }
    subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
    set(patch, source = 'ui') {
      const prev = this.state;
      this.state = Object.assign({}, prev, patch);
      for (const fn of this.subs) { try { fn(this.state, patch, source, prev); } catch (e) { console.error(e); } }
      clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => this.flush(), 150);
    }
    flush() { clearTimeout(this.persistTimer); save(KEY + '.settings', this.state); }
    setBpm(v, source) { this.set({ bpm: R.clamp(Math.round(v), 20, this.state.maxBpm) }, source); }

    /* ---- presets ---- */
    presetFromState(name) {
      const s = this.state;
      const pick = ['bpm', 'sig', 'accents', 'subdivision', 'subPattern', 'feel', 'soundAccent', 'soundBeat', 'soundSub', 'soundPoly',
        'masterVolume', 'accentVolume', 'subVolume', 'polyVolume', 'room', 'panBeat', 'panSub', 'panPoly', 'countInBars',
        'silent', 'trainer', 'progressive', 'poly', 'timer'];
      const data = {};
      for (const k of pick) data[k] = JSON.parse(JSON.stringify(s[k]));
      return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, created: Date.now(), data };
    }
    savePreset(name) {
      const p = this.presetFromState(name || 'Untitled preset');
      this.presets.unshift(p); save(KEY + '.presets', this.presets); return p;
    }
    updatePreset(id) {
      const i = this.presets.findIndex((p) => p.id === id); if (i < 0) return;
      const p = this.presetFromState(this.presets[i].name); p.id = id; p.created = this.presets[i].created;
      this.presets[i] = p; save(KEY + '.presets', this.presets);
    }
    loadPreset(id) {
      const p = this.presets.find((x) => x.id === id); if (!p) return;
      const clean = sanitize(Object.assign({}, this.state, JSON.parse(JSON.stringify(p.data))));
      const patch = { sessionName: p.name };
      for (const k of Object.keys(p.data)) patch[k] = clean[k];
      this.set(patch, 'preset');
    }
    duplicatePreset(id) {
      const p = this.presets.find((x) => x.id === id); if (!p) return;
      const c = JSON.parse(JSON.stringify(p)); c.id = Date.now().toString(36); c.name = p.name + ' copy'; c.created = Date.now();
      this.presets.unshift(c); save(KEY + '.presets', this.presets);
    }
    renamePreset(id, name) { const p = this.presets.find((x) => x.id === id); if (p) { p.name = name; save(KEY + '.presets', this.presets); } }
    deletePreset(id) { this.presets = this.presets.filter((p) => p.id !== id); save(KEY + '.presets', this.presets); }

    /* ---- accent patterns ---- */
    saveAccentPattern(name) {
      const s = this.state;
      this.accentPatterns.unshift({ id: Date.now().toString(36), name, beats: s.accents.length, accents: s.accents.slice() });
      save(KEY + '.accentPatterns', this.accentPatterns);
    }
    deleteAccentPattern(id) { this.accentPatterns = this.accentPatterns.filter((p) => p.id !== id); save(KEY + '.accentPatterns', this.accentPatterns); }

    /* ---- history ---- */
    addSession(entry) {
      this.history.unshift(entry);
      if (this.history.length > 200) this.history.length = 200;
      save(KEY + '.history', this.history);
    }
    clearHistory() { this.history = []; save(KEY + '.history', this.history); }
    stats() {
      const h = this.history;
      if (!h.length) return null;
      const total = h.reduce((a, s) => a + s.duration, 0);
      const dayKey = (t) => new Date(t).toDateString();
      const today = h.filter((s) => dayKey(s.date) === dayKey(Date.now())).reduce((a, s) => a + s.duration, 0);
      const days = new Set(h.map((s) => dayKey(s.date)));
      const weekAgo = Date.now() - 7 * 86400e3;
      const week = h.filter((s) => s.date > weekAgo);
      const weekDays = new Set(week.map((s) => dayKey(s.date))).size;
      const avgBpm = Math.round(h.reduce((a, s) => a + s.endBpm, 0) / h.length);
      let streak = 0; const d = new Date(); d.setHours(0, 0, 0, 0);
      while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
      return { sessions: h.length, total, today, avg: total / h.length, longest: Math.max(...h.map((s) => s.duration)), weekDays, avgBpm, streak };
    }
    reset() { this.set(Object.assign(sanitize({}), { theme: this.state.theme, palette: this.state.palette, terms: this.state.terms, mode: this.state.mode, help: this.state.help }), 'reset'); }
  }

  MN.Store = Store;
  MN.DEFAULTS = DEFAULTS;
})(typeof window !== 'undefined' ? window : globalThis);
