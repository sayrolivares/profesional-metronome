/* rhythm.js — pure tempo & rhythmic math. No DOM, no audio. */
(function (root) {
  const MN = (root.MN = root.MN || {});

  const MARKINGS = [
    { name: 'Grave', min: 20, max: 39 },
    { name: 'Largo', min: 40, max: 44 },
    { name: 'Lento', min: 45, max: 49 },
    { name: 'Larghetto', min: 50, max: 54 },
    { name: 'Adagio', min: 55, max: 65 },
    { name: 'Andante', min: 66, max: 75 },
    { name: 'Moderato', min: 76, max: 97 },
    { name: 'Allegretto', min: 98, max: 109 },
    { name: 'Allegro', min: 110, max: 139 },
    { name: 'Vivace', min: 140, max: 167 },
    { name: 'Presto', min: 168, max: 199 },
    { name: 'Prestissimo', min: 200, max: 300 },
  ];

  function marking(bpm) {
    let m = MARKINGS[0];
    for (const x of MARKINGS) if (bpm >= x.min) m = x;
    return m.name;
  }

  const SIGNATURES = [
    [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [2, 2], [3, 8], [6, 8], [9, 8], [12, 8],
  ];

  function isCompound(sig) {
    return sig.den >= 8 && sig.num % 3 === 0 && sig.num >= 6;
  }

  /* Beats per bar as the musician feels them. In compound feel, 6/8 = 2 beats. */
  function beatsPerBar(sig) {
    return isCompound(sig) && sig.compound ? sig.num / 3 : sig.num;
  }

  /* The BPM always refers to one felt beat (the denominator note, or the dotted
     denominator note in compound feel). */
  function beatSeconds(bpm) {
    return 60 / bpm;
  }

  const NOTE_GLYPH = { 1: '𝅝', 2: '𝅗𝅥', 4: '♩', 8: '♪', 16: '𝅘𝅥𝅯', 32: '𝅘𝅥𝅰' };
  function beatUnitLabel(sig) {
    const g = NOTE_GLYPH[sig.den] || '♩';
    return isCompound(sig) && sig.compound ? g + '.' : g;
  }

  /* Default accent pattern: 3 = strong, 2 = medium, 1 = normal, 0 = silent. */
  function defaultAccents(sig) {
    const n = beatsPerBar(sig);
    const a = new Array(n).fill(1);
    if (n > 0) a[0] = 3;
    if (!(isCompound(sig) && sig.compound) && isCompound(sig)) {
      for (let i = 3; i < n; i += 3) a[i] = 2; // 6/8 as six: accent 1 and 4
    } else if (n === 4) a[2] = 2;
    else if (n === 6) a[3] = 2;
    else if (n === 5) a[3] = 2;
    else if (n === 7) a[3] = 2;
    return a;
  }

  /* Fractional positions of each subdivision pulse within one beat. */
  const FEEL_RATIO = { straight: 0.5, swing: 2 / 3, shuffle: 0.7, dotted: 0.75 };
  function subOffsets(n, feel) {
    const r = FEEL_RATIO[feel] || 0.5;
    const out = [];
    if (n % 2 === 0 && r !== 0.5) {
      const pair = 2 / n;
      for (let i = 0; i < n; i++) out.push(Math.floor(i / 2) * pair + (i % 2 ? r * pair : 0));
    } else {
      for (let i = 0; i < n; i++) out.push(i / n);
    }
    return out;
  }

  const SUBDIVISIONS = [
    { n: 1, label: 'Quarter', id: 'quarter' },
    { n: 2, label: 'Eighths', id: 'eighth' },
    { n: 3, label: 'Triplets', id: 'triplet' },
    { n: 4, label: 'Sixteenths', id: 'sixteenth' },
    { n: 6, label: 'Sextuplets', id: 'sextuplet' },
    { n: 8, label: 'Thirty-seconds', id: 'thirtysecond' },
  ];

  /* Tap tempo with rolling average and sanity filtering. */
  class TapTempo {
    constructor({ resetAfter = 2.0, minInterval = 0.18, maxInterval = 3.0, window = 6 } = {}) {
      this.taps = [];
      this.resetAfter = resetAfter;
      this.minInterval = minInterval;
      this.maxInterval = maxInterval;
      this.window = window;
    }
    tap(now) {
      const last = this.taps[this.taps.length - 1];
      if (last !== undefined) {
        const gap = now - last;
        if (gap > this.resetAfter || gap > this.maxInterval) this.taps = [];
        else if (gap < this.minInterval) return this.bpm();
      }
      this.taps.push(now);
      if (this.taps.length > this.window + 1) this.taps.shift();
      return this.bpm();
    }
    bpm() {
      if (this.taps.length < 2) return null;
      const intervals = [];
      for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      return Math.round(60 / avg);
    }
    count() { return this.taps.length; }
    reset() { this.taps = []; }
  }

  /* Tempo trainer: next tempo after an interval has elapsed. */
  function trainerStep(current, cfg) {
    const dir = cfg.target >= cfg.start ? 1 : -1;
    // Already at or past the target (e.g. the player moved the tempo by hand): hold, never jump back.
    if (dir > 0 ? current >= cfg.target : current <= cfg.target) return current;
    const next = current + dir * Math.abs(cfg.step);
    if (dir > 0) return Math.min(next, cfg.target);
    return Math.max(next, cfg.target);
  }

  /* Progressive practice: which stage is active at elapsed seconds. */
  function progressiveStage(stages, elapsed) {
    let acc = 0;
    for (let i = 0; i < stages.length; i++) {
      acc += stages[i].seconds;
      if (elapsed < acc) return { index: i, bpm: stages[i].bpm, remaining: acc - elapsed };
    }
    return null;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  MN.rhythm = {
    MARKINGS, marking, SIGNATURES, isCompound, beatsPerBar, beatSeconds, beatUnitLabel,
    defaultAccents, subOffsets, SUBDIVISIONS, TapTempo, trainerStep, progressiveStage, clamp,
  };
})(typeof window !== 'undefined' ? window : globalThis);
